import { Injectable, Logger } from '@nestjs/common';
import { Article } from 'generated/prisma/client';
import { AiService } from 'src/ai/ai.service';
import { BATCH_OPTIONS } from 'src/constants/batch-options';
import { ERROR_MESSAGE } from 'src/constants/error-message';
import { PrismaService } from 'src/prisma/prisma.service';
import { BM25Service } from './bm25.service';
import { BraveSearchService } from './brave-search.service';
import { CrawlingService } from './crawling.service';
import { createConceptPrompts } from './prompts/create-concept-prompts';
import { createExamplePrompts } from './prompts/create-example-prompts';
import { createExplorationPrompts } from './prompts/create-exploration-prompts';
import { createImportancePrompts } from './prompts/create-importance-prompts';
import { createQuizzesPrompts } from './prompts/create-quizzes-prompts';
import { createRelatedWordsPrompts } from './prompts/create-related-words-prompts';
import { createSummaryPrompts } from './prompts/create-summary-prompts';
import { articleSchema, quizArraySchema } from './schemas/schemas';
import { KeywordInfo } from './types/types';

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(
    private readonly braveSearchService: BraveSearchService,
    private readonly crawlingService: CrawlingService,
    private readonly prismaService: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async generateContents(keywordId: bigint): Promise<void> {
    this.logger.log(`Starting content generation for keyword ID: ${keywordId}`);

    if (await this.isArticleExists(keywordId)) {
      if (await this.isQuizExists(keywordId)) {
        this.logger.warn(`Contents already exist for keyword ID: ${keywordId}`);
        throw new Error(ERROR_MESSAGE.CONTENTS_ALREADY_EXISTS);
      }

      await this.generateQuizzes(keywordId);
      this.logger.log(
        `Successfully completed content generation for keyword ID: ${keywordId}`,
      );
      return;
    }

    const keywordInfo = await this.findKeyword(keywordId);

    const prompts = await this.createPrompts(keywordInfo);
    await this.generateArticles(keywordId, prompts);
    await this.generateQuizzes(keywordId);

    this.logger.log(
      `Successfully completed content generation for keyword ID: ${keywordId}`,
    );
  }

  private async findKeyword(keywordId: bigint): Promise<KeywordInfo> {
    this.logger.log(`Finding keyword with ID: ${keywordId}`);

    const keyword = await this.prismaService.keyword.findUnique({
      select: {
        name: true,
        description: true,
      },
      where: {
        id: keywordId,
      },
    });

    if (!keyword) {
      this.logger.error(`Keyword not found with ID: ${keywordId}`);
      throw new Error(ERROR_MESSAGE.KEYWORD_NOT_FOUND);
    }

    this.logger.log(`Successfully found keyword: ${keyword.name}`);
    return keyword;
  }

  private async generateRelatedData(keywordInfo: KeywordInfo) {
    this.logger.log(`Generating related data for keyword: ${keywordInfo.name}`);

    const query = this.generateQuery(keywordInfo);

    this.logger.log(`Searching for keyword with query: ${query}`);
    const searchResults = await this.braveSearchService.searchByKeyword(query);
    this.logger.log(`Found ${searchResults.length} search results`);

    this.logger.log('Starting web crawling for search results');
    const crawledArr = await Promise.all(
      searchResults.map(async (result) => {
        return this.crawlingService.crawlWebsite(result);
      }),
    );

    const validDocs = crawledArr
      .filter((data) => data !== null)
      .map(({ title, texts }) => ({ title, content: texts.join('\n') }))
      .filter(
        ({ content }) =>
          content.length <= BATCH_OPTIONS.MAX_TEXT_LENGTH_FOR_BM25,
      );

    this.logger.log(
      `Filtered ${validDocs.length} valid documents for BM25 ranking`,
    );

    const bm25Service = new BM25Service(validDocs);

    const mostRelatedDocs = bm25Service
      .search(query)
      .map(({ document }) => document);

    this.logger.log(
      `BM25 ranking completed, found ${mostRelatedDocs.length} related documents`,
    );
    return JSON.stringify(mostRelatedDocs);
  }

  private async createPrompts(keywordInfo: KeywordInfo): Promise<string[]> {
    this.logger.log(`Creating prompts for keyword: ${keywordInfo.name}`);

    const relatedData = await this.generateRelatedData(keywordInfo);

    const prompts = [
      createConceptPrompts(
        keywordInfo.name,
        keywordInfo.description,
        relatedData,
      ),
      createExamplePrompts(
        keywordInfo.name,
        keywordInfo.description,
        relatedData,
      ),
      createRelatedWordsPrompts(
        keywordInfo.name,
        keywordInfo.description,
        relatedData,
      ),
      createImportancePrompts(
        keywordInfo.name,
        keywordInfo.description,
        relatedData,
      ),
      createExplorationPrompts(
        keywordInfo.name,
        keywordInfo.description,
        relatedData,
      ),
    ];

    this.logger.log(`Successfully created ${prompts.length} prompts`);
    return prompts;
  }

  private async generateArticles(
    keywordId: bigint,
    prompts: string[],
  ): Promise<Article[]> {
    this.logger.log(
      `Generating articles for keyword ID: ${keywordId} with ${prompts.length} prompts`,
    );

    this.logger.log('Generating article titles and contents from AI');
    const titleAndContents = await Promise.all(
      prompts.map((prompt) => {
        return this.aiService.generateObjFromAi(
          'gemini',
          prompt,
          articleSchema,
        );
      }),
    );
    this.logger.log(
      `Successfully generated ${titleAndContents.length} articles`,
    );

    this.logger.log('Generating summaries for articles');
    const summaries = await Promise.all(
      titleAndContents.map((titleAndContent) => {
        return this.aiService.generateTextFromAi(
          'gemini',
          createSummaryPrompts(titleAndContent.content),
        );
      }),
    );
    this.logger.log(`Successfully generated ${summaries.length} summaries`);

    const publishedAt = await this.getKeywordPublishedDate(keywordId);

    const createArticleDtos = titleAndContents.map((titleAndContent, idx) => ({
      ...titleAndContent,
      summary: summaries[idx],
      publishedAt,
      keywordId,
    }));

    const articles: Article[] = [];

    this.logger.log('Saving articles to database');
    await this.prismaService.$transaction(async (prisma) => {
      for (const article of createArticleDtos) {
        const newArticle = await prisma.article.create({
          data: article,
        });

        articles.push(newArticle);
      }
    });

    this.logger.log(
      `Successfully saved ${articles.length} articles to database`,
    );
    return articles;
  }

  private async generateQuizzes(keywordId: bigint): Promise<void> {
    this.logger.log(`Generating quizzes for keyword ID: ${keywordId}`);

    const articles = await this.prismaService.article.findMany({
      where: {
        keywordId,
      },
    });

    this.logger.log(`Found ${articles.length} articles for quiz generation`);

    this.logger.log('Generating quizzes from AI');
    const quizzes = await Promise.all(
      articles.map(async (article) => {
        return {
          ...(await this.aiService.generateObjFromAi(
            'gemini',
            createQuizzesPrompts(article.content),
            quizArraySchema,
          )),
          articleId: article.id,
        };
      }),
    );

    const totalQuizCount = quizzes.reduce(
      (sum, q) => sum + q.quizzes.length,
      0,
    );
    this.logger.log(
      `Successfully generated ${totalQuizCount} quizzes for ${articles.length} articles`,
    );

    this.logger.log('Saving quizzes to database');
    await this.prismaService.$transaction(async (prisma) => {
      await Promise.all(
        quizzes.map(async ({ articleId, quizzes }) => {
          for (const { answer, ...rest } of quizzes) {
            await prisma.quiz.create({
              data: { ...rest, answer: String(answer), articleId },
            });
          }
        }),
      );
    });

    this.logger.log(`Successfully saved ${totalQuizCount} quizzes to database`);
  }

  private generateQuery(keywordInfo: KeywordInfo): string {
    const query = `${keywordInfo.name} ${keywordInfo.description.split('.')[0]}`;
    this.logger.log(`Generated search query: ${query}`);
    return query;
  }

  private async isArticleExists(keywordId: bigint): Promise<boolean> {
    this.logger.log(`Checking if article exists for keyword ID: ${keywordId}`);

    const article = await this.prismaService.article.findFirst({
      select: {
        id: true,
      },
      where: {
        keywordId,
      },
    });

    const exists = !!article;
    this.logger.log(
      `Article ${exists ? 'exists' : 'does not exist'} for keyword ID: ${keywordId}`,
    );
    return exists;
  }

  private async isQuizExists(keywordId: bigint): Promise<boolean> {
    this.logger.log(`Checking if quiz exists for keyword ID: ${keywordId}`);

    const quiz = await this.prismaService.quiz.findFirst({
      select: {
        id: true,
      },
      where: {
        Article: {
          keywordId,
        },
      },
    });

    const exists = !!quiz;
    this.logger.log(
      `Quiz ${exists ? 'exists' : 'does not exist'} for keyword ID: ${keywordId}`,
    );
    return exists;
  }

  private async getKeywordPublishedDate(keywordId: bigint) {
    const keyword = await this.prismaService.keyword.findUnique({
      select: {
        TodaysKeyword: {
          select: {
            date: true,
          },
        },
      },
      where: {
        id: keywordId,
      },
    });

    if (!keyword) {
      throw new Error(ERROR_MESSAGE.KEYWORD_NOT_FOUND);
    }

    if (!keyword.TodaysKeyword[0]) {
      throw new Error(ERROR_MESSAGE.KEYWORD_DATE_NOT_EXISTS);
    }

    return keyword.TodaysKeyword[0].date;
  }
}

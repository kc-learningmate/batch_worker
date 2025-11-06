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
import { createImportancePrompts } from './prompts/create-importace-prompts';
import { createQuizzesPrompts } from './prompts/create-quizzes-propmts';
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

    const keywordInfo = await this.findKeyword(keywordId);

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

    const prompts = await this.createPrompts(keywordInfo);
    await this.generateArticles(keywordId, prompts);
    await this.generateQuizzes(keywordId);

    this.logger.log(
      `Successfully completed content generation for keyword ID: ${keywordId}`,
    );
  }

  private async findKeyword(keywordId: bigint): Promise<KeywordInfo> {
    const keyword = await this.prismaService.keyword.findUnique({
      select: {
        name: true,
        description: true,
      },
      where: {
        id: keywordId,
      },
    });

    if (!keyword) throw new Error(ERROR_MESSAGE.KEYWORD_NOT_FOUND);

    return keyword;
  }

  private async generateRelatedData(keywordInfo: KeywordInfo) {
    const query = this.generateQuery(keywordInfo);

    const searchResults = await this.braveSearchService.searchByKeyword(query);

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

    const bm25Service = new BM25Service(validDocs);

    const mostRelatedDocs = bm25Service
      .search(query)
      .map(({ document }) => document);

    return JSON.stringify(mostRelatedDocs);
  }

  private async createPrompts(keywordInfo: KeywordInfo): Promise<string[]> {
    const relatedData = await this.generateRelatedData(keywordInfo);

    return [
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
  }

  private async generateArticles(
    keywordId: bigint,
    prompts: string[],
  ): Promise<Article[]> {
    const titleAndContents = await Promise.all(
      prompts.map((prompt) => {
        return this.aiService.generateObjFromAi(
          'gemini',
          prompt,
          articleSchema,
        );
      }),
    );

    const summaries = await Promise.all(
      titleAndContents.map((titleAndContent) => {
        return this.aiService.generateTextFromAi(
          'gemini',
          createSummaryPrompts(titleAndContent.content),
        );
      }),
    );

    const createArticleDtos = titleAndContents.map((titleAndContent, idx) => ({
      ...titleAndContent,
      summary: summaries[idx],
      publishedAt: new Date(),
      keywordId,
    }));

    const articles: Article[] = [];

    await this.prismaService.$transaction(async (prisma) => {
      for (const article of createArticleDtos) {
        const newArticle = await prisma.article.create({
          data: article,
        });

        articles.push(newArticle);
      }
    });

    return articles;
  }

  private async generateQuizzes(keywordId: bigint): Promise<void> {
    const articles = await this.prismaService.article.findMany({
      where: {
        keywordId,
      },
    });

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
  }

  private generateQuery(keywordInfo: KeywordInfo): string {
    console.log(
      `query >>>>>>: ${keywordInfo.name} ${keywordInfo.description.split('.')[0]}`,
    );
    return `${keywordInfo.name} ${keywordInfo.description.split('.')[0]}`;
  }

  private async isArticleExists(keywordId: bigint): Promise<boolean> {
    const article = await this.prismaService.article.findFirst({
      select: {
        id: true,
      },
      where: {
        keywordId,
      },
    });

    return !!article;
  }

  private async isQuizExists(keywordId: bigint): Promise<boolean> {
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

    return !!quiz;
  }
}

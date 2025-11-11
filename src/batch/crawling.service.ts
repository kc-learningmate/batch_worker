import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import QuickLRU from 'quick-lru';
import robotsParser from 'robots-parser';
import { BATCH_OPTIONS } from 'src/constants/batch-options';
import { fetchWithTimeout } from 'src/utils/fetch-with-timeout';
import { CrawlResult, SearchResult } from './types/types';

@Injectable()
export class CrawlingService {
  private readonly logger = new Logger(CrawlingService.name);

  constructor() {}

  private robotsCache = new QuickLRU<string, boolean>({
    maxSize: 1000,
    maxAge: 3600 * 1000,
  });

  async crawlWebsite({
    title,
    url,
  }: SearchResult): Promise<CrawlResult | null> {
    try {
      const isAllowed = await this.isUrlAllowed(url);
      if (!isAllowed) {
        this.logger.warn(`Crawling not allowed for ${url} by robots.txt`);
        return null;
      }

      const response = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': BATCH_OPTIONS.USER_AGENT,
        },
      });

      if (!response.ok) {
        this.logger.error(`Failed to fetch ${url}: ${response.status}`);
        return null;
      }

      const html = await response.text();

      return this.extractContent(html, title);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn(`Timeout fetching ${url}`);
      } else {
        this.logger.warn(`Failed to crawl ${url}`);
      }
      return null;
    }
  }

  private extractContent(html: string, title: string): CrawlResult {
    const $ = cheerio.load(html);
    $(BATCH_OPTIONS.REMOVE_SELECTORS).remove();

    const textSet = new Set<string>();

    $(BATCH_OPTIONS.SELECTORS).each((_, element) => {
      if ($(element).find(BATCH_OPTIONS.SELECTORS).length > 0) return;

      const text = $(element).text().replace(/\s+/g, ' ').trim();
      if (text.length >= BATCH_OPTIONS.MIN_TEXT_LENGTH) {
        textSet.add(text);
      }
    });

    return { title, texts: Array.from(textSet) };
  }

  private async isUrlAllowed(
    targetUrl: string,
    userAgent: string = BATCH_OPTIONS.USER_AGENT,
  ): Promise<boolean> {
    const url = new URL(targetUrl);

    const robotsUrl = `${url.origin}/robots.txt`;

    if (this.robotsCache.has(robotsUrl)) {
      return this.robotsCache.get(robotsUrl)!;
    }

    try {
      const response = await fetchWithTimeout(robotsUrl);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const robotsTxt = await response.text();
      const robots = robotsParser(robotsUrl, robotsTxt);

      const isAllowed = robots.isAllowed(targetUrl, userAgent) ?? true;
      this.robotsCache.set(robotsUrl, isAllowed);

      return isAllowed;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn(`Timeout fetching robots.txt for ${robotsUrl}`);
        return false;
      }

      // robots.txt가 없거나 접근 불가능한 경우 허용
      this.logger.warn(
        `Failed to fetch robots.txt for ${robotsUrl}, allowing by default`,
      );
      this.robotsCache.set(robotsUrl, true);
      return true;
    }
  }
}

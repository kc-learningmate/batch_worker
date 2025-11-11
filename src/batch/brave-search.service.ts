import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BATCH_OPTIONS } from 'src/constants/batch-options';
import { ERROR_MESSAGE } from 'src/constants/error-message';
import { fetchWithTimeout } from 'src/utils/fetch-with-timeout';
import { EnvSchema } from '../config/validate-env';
import { SearchResult } from './types/types';

@Injectable()
export class BraveSearchService {
  constructor(private readonly configService: ConfigService<EnvSchema, true>) {}

  async searchByKeyword(keyword: string) {
    const query = `${keyword}`;
    const requestUrl = new URL(BATCH_OPTIONS.BRAVE_SEARCH_BASEURL);

    requestUrl.searchParams.set('q', query);
    requestUrl.searchParams.set('country', 'KR');
    requestUrl.searchParams.set('search_lang', 'ko');

    const response = await fetchWithTimeout(requestUrl, {
      headers: {
        'X-Subscription-Token': this.configService.get<string>(
          'BRAVE_SEARCH_API_KEY',
        ),
      },
    });

    if (!response.ok) {
      console.error(await response.json());
      throw Error(ERROR_MESSAGE.BRAVE_SEARCH_API_REQUEST_FAILED);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const results = (await response.json()).web.results as SearchResult[];

    return results.map(({ title, url, description }) => ({
      title,
      url,
      description,
    }));
  }
}

export const BATCH_OPTIONS = {
  BRAVE_SEARCH_BASEURL: 'https://api.search.brave.com/res/v1/web/search',
  USER_AGENT: 'Mozilla/5.0',
  REMOVE_SELECTORS:
    'script, style, nav, header, footer, form, button, link, a, iframe, noscript, svg, canvas, input, select, textarea, label, aside, img',
  SELECTORS: 'article, section, p, blockquote, dt, dd, div',
  MIN_TEXT_LENGTH: 30,
  MAX_TEXT_LENGTH_FOR_BM25: 1000,
  CHUNK_SIZE: 800,
  QUEUE_NAME: 'batch',
  JOB_NAME: 'generate',
} as const;

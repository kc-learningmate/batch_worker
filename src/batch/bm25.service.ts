import { BM25Config, CrawledDocument } from './types/types';

/**
 * BM25 (Best Matching 25) 랭킹 알고리즘을 구현한 서비스 클래스입니다.
 *
 * 이 클래스는 생성자에서 문서 컬렉션을 받아 초기화(인덱싱)를 수행하며,
 * 'search' 메서드를 통해 쿼리에 가장 관련성이 높은 문서를 찾아 반환합니다.
 *
 * @remarks
 * ### BM25 기본 공식:
 *
 * Score(D, Q) = Σ [ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * (|D| / avgdl))) ]
 *
 * ---
 *
 * ### 공식과 클래스 속성/메서드 매핑:
 *
 * 1. **IDF(qi) (Inverse Document Frequency)**:
 * - Term(qi)의 희소성. `calculateIDF(qi)` 메서드에서 계산됩니다.
 * - `N`: 전체 문서 수 (`this.documents.length`).
 * - `n(qi)`: Term `qi`를 포함하는 문서 수 (`this.documentCntsHasTerm.get(qi)`).
 *
 * 2. **Term 빈도 및 문서 길이 가중치**:
 * - `f(qi, D)`: 문서 D 내 Term `qi`의 빈도 (`this.termFrequencies.get(D.title).get(qi)`).
 * - `|D|`: 문서 D의 길이 (토큰 수) (`this.docLengths.get(D.title)`).
 * - `avgdl`: 평균 문서 길이 (`this.avgDocLength`).
 *
 * 3. **하이퍼파라미터 (`this.config`)**:
 * - `k1`: Term 빈도 포화도 (기본값 1.5).
 * - `b`: 문서 길이 정규화 강도 (기본값 0.75).
 */
export class BM25Service {
  /** 원본 문서 데이터 배열 */
  private documents: CrawledDocument[];

  /** BM25 하이퍼파라미터 (k1, b) */
  private config: BM25Config;

  /** 전체 문서의 평균 길이 (avgdl) */
  private avgDocLength: number;

  /** 문서 제목(title)을 키로, 해당 문서의 토큰 수(길이, |D|)를 값으로 저장 */
  private docLengths: Map<string, number>; //docTitle -> docLength

  /** 문서 제목(title)과 term을 키로, 해당 term의 문서 내 빈도(f(qi, D))를 저장 */
  private termFrequencies: Map<string, Map<string, number>>; // docTitle -> term -> frequency

  /** Term을 키로, 해당 term을 포함하는 문서의 수(n(qi))를 저장 */
  private documentCntsHasTerm: Map<string, number>; // term -> number of docs containing term

  /** 계산된 IDF 값을 캐싱하여 중복 계산을 방지 */
  private idfCache: Map<string, number>;

  constructor(
    documents: CrawledDocument[],
    config: Partial<BM25Config> = { k1: 1.5 },
  ) {
    this.documents = documents;
    this.config = {
      k1: config.k1 ?? 1.5,
      b: config.b ?? 0.75,
    };
    this.docLengths = new Map();
    this.termFrequencies = new Map();
    this.documentCntsHasTerm = new Map();
    this.idfCache = new Map();
    this.avgDocLength = 0;

    this.initialize();
  }

  /**
   * 생성자에서 호출되며, 모든 문서에 대해 초기 인덱싱을 수행합니다.
   * - 각 문서의 길이 계산 (`docLengths`)
   * - Term 빈도(TF) 계산 (`termFrequencies`)
   * - 문서 빈도(DF) 계산 (`documentCntsHasTerm`)
   * - 전체 문서의 평균 길이 계산 (`avgDocLength`)
   */
  private initialize(): void {
    let totalLength = 0;

    for (const doc of this.documents) {
      const tokens = this.tokenize(doc.content);
      const docLength = tokens.length;

      this.docLengths.set(doc.title, docLength);
      totalLength += docLength;

      //용어 빈도 계산
      const termFreq = new Map<string, number>();
      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
      }
      this.termFrequencies.set(doc.title, termFreq);

      //특정 용어를 갖고 있는 문서 수 계산
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        this.documentCntsHasTerm.set(
          term,
          this.documentCntsHasTerm.get(term) ?? 0 + 1,
        );
      }
    }

    // 평균 문서 길이 계산
    this.avgDocLength = totalLength / this.documents.length;
  }

  search(query: string, topK: number = 7) {
    const queryTerms = this.tokenize(query);

    const results = this.documents.map((doc) => ({
      document: doc,
      score: this.caculateScore(doc.title, queryTerms),
    }));

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((result) => result.score > 0);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 0);
  }

  private calculateIDF(term: string): number {
    if (this.idfCache.has(term)) {
      return this.idfCache.get(term)!;
    }

    const N = this.documents.length; // 문서의 총 개수
    const df = this.documentCntsHasTerm.get(term) ?? 0; // term 을 갖고 있는 문서 개수

    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    this.idfCache.set(term, idf);

    return idf;
  }

  private caculateScore(title: string, queryTerm: string[]): number {
    const docLength = this.docLengths.get(title) ?? 0;
    const termFreq = this.termFrequencies.get(title);

    if (!termFreq) return 0;

    let score = 0;

    const { k1, b } = this.config;

    for (const term of queryTerm) {
      const tf = termFreq.get(term) ?? 0;
      if (tf === 0) continue;

      const idf = this.calculateIDF(term);

      const numerator = tf * (k1 + 1);
      const denominator =
        tf + k1 * (1 - b + b * (docLength / this.avgDocLength));

      score += idf * (numerator / denominator);
    }

    return score;
  }
}

export const createQuizzesPrompts = (content: string) => {
  return `
<content>${content}</content>
Content의 이해를 도울 수 있는 퀴즈 5개 작성해줘. 내용은 모두 한국어로 작성해줘
`;
};

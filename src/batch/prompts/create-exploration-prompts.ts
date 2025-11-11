export const createExplorationPrompts = (
  keyword: string,
  definition: string,
  json: string,
) => {
  return `# Task: Generate text to help learn economic terms

The following is reference data about "${keyword}":

<definition>${definition}</definition>

<reference_data>
${json}
</reference_data>

<task>
Using the data above, please write an educational text explaining the In-Depth Exploration and Common Misconceptions of "${keyword}".
</task>

<requirements>
- Length: Greater than 1000 characters and less than 2000 characters.
- Target audience: Learners encountering economic terms for the first time.
- Tone: Formal style.
- Prohibition : Since the concept of the keyword has already been written in another article, do not explain the concept of the keyword here.
- Structure: Write in the order of:
  - Identify and explain 1–2 common misconceptions or incorrect assumptions people often have about ${keyword}. (Example: "Is inflation always a bad thing?")
  - Provide an in-depth analysis by connecting ${keyword} to a recent economic issue.
  - Conclude by posing a thought-provoking question for the learner to ponder further.
- Format: News article format(no markdown needed).
</requirements>

<output_format>
Output only the explanatory text, without additional notes or meta information. Write all content in Korean.
</output_format>
`;
};

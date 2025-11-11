export const createRelatedWordsPrompts = (
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
Using the data above, please write an educational text explaining the related words of "${keyword}".
</task>

<requirements>
- Length: Greater than 1000 characters and less than 2000 characters.
- Target audience: Learners encountering economic terms for the first time.
- Tone: Formal style.
- Prohibition : Since the concept of the keyword has already been written in another article, do not explain the concept of the keyword here.
- Structure: Write in the order of:
  - Select 2–3 terms closely related to ${keyword} and explain their relationships.
  - If there is a clear opposing or conflicting concept, present it as well. (e.g., inflation ↔ deflation)
  - Describe a scenario where these terms appear together
- Format: News article format(no markdown needed).
</requirements>

<output_format>
Output only the explanatory text, without additional notes or meta information. Write all content in Korean.
</output_format>
`;
};

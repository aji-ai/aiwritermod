const { getModel, openaiClient, TITLE_MAX_TOKENS, ARTICLE_MAX_TOKENS, SUMMARY_MAX_TOKENS } = require("./api");
const { logger } = require("./logger");
const { calculateCost } = require("./serp");

const wordcount = require("word-count");

const generateArticle = async (topic, summaries, activeModel) => {
  // Add debug logging
  console.log(`Starting article generation with ${summaries.length} summaries`);
  
  // Separate local and web sources
  const localSources = summaries.filter(s => s.isLocal).map(s => s.content);
  const webSources = summaries
    .filter(s => !s.isLocal)
    .map(s => `Source: ${s.source}\n${s.content}`);
  const hasLocalSources = localSources.length > 0;

  const minimumWordCount = 1700;

  const sourceMaterials = hasLocalSources 
    ? `PRIMARY SOURCE MATERIALS (direct quotes and key ideas must be used from these):
${localSources.join("\n\n---\n\n")}

SUPPORTING WEB RESEARCH:
${webSources.join("\n\n---\n\n")}`
    : `SOURCE MATERIALS:
${webSources.join("\n\n---\n\n")}`;

  const sourceRequirements = hasLocalSources 
    ? `- Prioritize and heavily quote from PRIMARY SOURCE MATERIALS
- Use web sources only to supplement primary source information
- Each major claim should start with primary source information
- Maintain original terminology from primary sources`
    : `- Use information from provided sources
- Include relevant quotes with proper attribution
- Maintain consistent terminology throughout`;

  const messages = [];
  
  if (activeModel.startsWith('o1')) {
    const sourceContext = hasLocalSources 
      ? `SOURCE HIERARCHY:
1. PRIMARY SOURCES: Direct, authoritative materials that must be heavily quoted and prioritized
2. WEB SOURCES: Supporting information to provide additional context only`
      : `SOURCE CONTEXT:
All sources are from web research and should be treated with equal weight`;

    const processSteps = hasLocalSources
      ? `1. First analyze PRIMARY SOURCES to identify key themes and verified facts
2. Then review WEB SOURCES for supporting context
3. Organize information prioritizing PRIMARY SOURCE content`
      : `1. Analyze all sources to identify key themes and verified facts
2. Cross-reference information across multiple sources when possible
3. Organize information into a coherent narrative`;

    messages.push({
      role: "user",
      content: `TASK: Write an engaging web article about ${topic} based on the provided sources.

CONTEXT:
- Target audience: Web readers seeking informative, accessible content
- Purpose: Educate and inform while maintaining reader engagement
- Style: Conversational but authoritative

${sourceContext}

CRITICAL REQUIREMENTS:
${sourceRequirements}
- Only use information explicitly present in the provided source materials
- Do not infer, speculate, or fabricate details
- If the source materials do not mention specific facts, clearly state that the information is unavailable
- Each claim must be traceable to a specific source

PROCESS:
${processSteps}
4. Write in clear, accessible language while maintaining accuracy
5. Include relevant quotes with proper attribution
6. Structure content for web readability

OUTPUT REQUIREMENTS:
1. Format: Clean Markdown with clear section headers
2. Length: Minimum ${minimumWordCount} words
3. Structure:
   - Engaging opening hook based on verified information
   - Clear section breaks with descriptive headers
   - Short, focused paragraphs
   - Natural transitions between ideas
   - Concluding "Key Takeaways" section
4. Content:
   - Use direct quotes with proper attribution
   - Include only specific examples and data points from sources
   - Explain complex concepts simply
   - Maintain strict factual accuracy
   - Indicate source for each major claim

EVALUATION CRITERIA:
1. Source Adherence: Every claim must be directly supported by source materials
2. Accuracy: No inferred or speculated information
3. Transparency: Clear acknowledgment of information gaps
4. Readability: Content should be easily understood by general audience
5. Structure: Organized for web reading patterns

SOURCE MATERIALS:
${sourceMaterials}

Begin by analyzing the sources, then write the article following the process above while strictly adhering to the critical requirements.`
    });
  } else {
    messages.push({ 
      role: "system", 
      content: "You are an expert at creating engaging web content that makes complex topics accessible while maintaining accuracy. Write in a conversational style and only use information from provided sources." 
    });
    messages.push({ 
      role: "user", 
      content: `Write an engaging web article about ${topic}.

Key requirements:
- Use clear, accessible language
- Include relevant quotes from sources
- Structure for web readability
- Minimum ${minimumWordCount} words
- Format in Markdown
- End with practical takeaways

SOURCE MATERIALS:
${sourceMaterials}` 
    });
  }

  try {
    logger.info('Sending request to OpenAI...');
    const completionOptions = {
      model: activeModel,
      messages
    };

    // Add different token limits based on model type
    if (activeModel.startsWith('o1')) {
      completionOptions.max_completion_tokens = ARTICLE_MAX_TOKENS;
    } else {
      completionOptions.max_tokens = ARTICLE_MAX_TOKENS;
      completionOptions.temperature = 0.3;
    }

    logger.info(`Sending completion request with ${messages.length} messages`);
    const response = await openaiClient.chat.completions.create(completionOptions);
    
    logger.info('Response received from OpenAI');
    logger.info('Full response:', JSON.stringify(response, null, 2));
    
    if (!response.choices?.[0]?.message?.content) {
      logger.error('Response structure:', JSON.stringify({
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        hasMessage: !!response.choices?.[0]?.message,
        content: response.choices?.[0]?.message?.content
      }));
      throw new Error('Invalid or empty response from OpenAI');
    }

    const usage = response.usage;
    const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, activeModel);

    logger.info(`Generated article length: ${response.choices[0].message.content.length} characters`);

    return {
      content: response.choices[0].message.content,
      usage,
      cost
    };
  } catch (error) {
    logger.error('Error in article generation:', error);
    if (error.response) {
      logger.error('OpenAI Error:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    throw error;
  }
};

module.exports = {
  generateArticle,
};

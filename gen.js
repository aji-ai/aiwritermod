const { getModel, openaiClient, TITLE_MAX_TOKENS, ARTICLE_MAX_TOKENS, SUMMARY_MAX_TOKENS } = require("./api");
const { logger } = require("./logger");
const { calculateCost } = require("./serp");

const wordcount = require("word-count");

const analyzeSourceRelevance = async (topic, localSources) => {
  // Extract key terms from the topic
  const topicTerms = topic.toLowerCase().split(/\s+/);
  
  // Have the LLM analyze the sources
  const analysisPrompt = `TASK: Analyze these academic/technical source materials and extract their key themes and topics.

SOURCE MATERIALS:
${localSources.join("\n\n---\n\n")}

OUTPUT REQUIREMENTS:
1. Main Topics: List the primary topics/themes discussed across all sources
2. Key Concepts: Extract important theoretical frameworks and concepts
3. Technologies: Identify specific technologies, systems, or implementations mentioned
4. Applications: List concrete applications or use cases described

Format the output as JSON with these exact keys:
{
  "mainTopics": [],
  "concepts": [],
  "technologies": [],
  "applications": []
}`;

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',  // Use a smaller model for analysis
      messages: [{
        role: 'user',
        content: analysisPrompt
      }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    // Check topic relevance
    const topicOverlap = topicTerms.some(term => 
      analysis.mainTopics.some(topic => topic.toLowerCase().includes(term)) ||
      analysis.concepts.some(concept => concept.toLowerCase().includes(term)) ||
      analysis.technologies.some(tech => tech.toLowerCase().includes(term))
    );

    return {
      isRelevant: true,
      sourceThemes: {
        mainTopic: analysis.mainTopics.join('; '),
        concepts: analysis.concepts,
        technologies: analysis.technologies,
        applications: analysis.applications
      },
      suggestedFocus: topicOverlap
        ? `These sources discuss ${analysis.mainTopics.join(', ')}, which relate to ${topic} through shared concepts in ${analysis.concepts.join(', ')}`
        : `While these sources focus on ${analysis.mainTopics.join(', ')}, they contain relevant technological and conceptual frameworks that can inform our understanding of ${topic}`
    };
  } catch (error) {
    logger.error('Error analyzing source relevance:', error);
    // Fallback to basic analysis if LLM fails
    return {
      isRelevant: true,
      sourceThemes: {
        mainTopic: topic,
        concepts: [],
        technologies: [],
        applications: []
      },
      suggestedFocus: `Analyzing ${topic} using available source materials`
    };
  }
};


const generateArticle = async (topic, summaries, activeModel) => {
  console.log(`Starting article generation with ${summaries.length} summaries`);
  
  // Use Anthropic handler for Claude models
  if (activeModel.startsWith('claude-')) {
    return generateArticleWithAnthropic(topic, summaries, activeModel);
  }
  
  // Separate local and web sources
  const localSources = summaries
    .filter(s => s.isLocal)
    .map(s => {
      logger.debug('Processing local source:', {
        hasContent: !!s.content,
        contentType: typeof s.content,
        contentLength: s.content?.length
      });
      return s.content;
    })
    .filter(Boolean);  // Remove any null/undefined entries

    const hasLocalSources = localSources.length > 0;
  
    // Add source analysis for OpenAI path
    const sourceAnalysis = hasLocalSources ? await analyzeSourceRelevance(topic, localSources) : null;

    // Add source analysis logging
    if (sourceAnalysis) {
      logger.info('*** Source analysis results (OpenAI):', {
        isRelevant: sourceAnalysis.isRelevant,
        mainTopic: sourceAnalysis.sourceThemes.mainTopic,
        concepts: sourceAnalysis.sourceThemes.concepts,
        technologies: sourceAnalysis.sourceThemes.technologies,
        applications: sourceAnalysis.sourceThemes.applications,
        suggestedFocus: sourceAnalysis.suggestedFocus
      });
    }

    
  const webSources = summaries
    .filter(s => !s.isLocal)
    .map(s => `Source: ${s.source}\n${s.content}`);

  const minimumWordCount = 1700;

  // Construct source materials based on what's available
  const sourceMaterials = hasLocalSources 
    ? `PRIMARY SOURCE MATERIALS (direct quotes and key ideas must be used from these):
${localSources.join("\n\n---\n\n")}

${webSources.length > 0 
  ? `SUPPORTING WEB RESEARCH:
${webSources.join("\n\n---\n\n")}`
  : "No web sources available"}`
    : `WEB RESEARCH MATERIALS:
${webSources.join("\n\n---\n\n")}`;

  // Adjust requirements based on source availability
  const sourceRequirements = hasLocalSources 
    ? `CRITICAL SOURCE REQUIREMENTS:
- Start with and heavily quote from PRIMARY SOURCE MATERIALS
- Use primary source framework and concepts as the foundation
- Each major section must begin with primary source content
- Only use web sources to supplement primary source information
- Maintain original terminology from primary sources
- Clearly mark any comparative analysis or connections
- If source material differs from the topic, explain how concepts relate
- Include explicit source attributions for all claims`
    : `SOURCE REQUIREMENTS:
- Use information only from provided web sources
- Include relevant quotes with proper attribution
- Maintain consistent terminology
- Clearly state when making interpretations
- Mark any uncertain information with qualifying language`;

  // Construct contextual guidance only if we have valid local sources
  const contextualGuidance = hasLocalSources && sourceAnalysis
    ? `CONTENT APPROACH:
- Primary source focuses on: ${sourceAnalysis.sourceThemes.mainTopic}
- Key concepts to incorporate: ${sourceAnalysis.sourceThemes.concepts.join(', ')}
- Use these concepts as analytical framework when examining ${topic}
- Draw connections while maintaining factual accuracy
- Clearly indicate when making comparative analyses`
    : `NOTE: Use available sources to:
- Identify relevant technological and conceptual parallels
- Compare methodological approaches
- Draw appropriate connections
- Maintain clear source attribution
- Be explicit about analytical scope`;

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

  let messages;
  if (activeModel.startsWith('o1')) {
    messages = [{
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

SOURCE MATERIALS:
${sourceMaterials}

Begin by analyzing the sources, then write the article following the process above while strictly adhering to the critical requirements.`
    }];
  } else {
    messages = [{
      role: "system",
      content: "You are an expert at creating engaging web content that makes complex topics accessible while maintaining strict source accuracy. You excel at drawing meaningful connections while clearly separating fact from analysis."
    }, {
      role: "user",
      content: `Write an engaging web article about ${topic}.

${sourceMaterials}

${sourceRequirements}

${contextualGuidance}

OUTPUT FORMAT:
- Clear, accessible language
- Proper source attribution
- Markdown formatting
- Minimum ${minimumWordCount} words
- Include practical takeaways`
    }];
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
    logger.debug('Raw response:', JSON.stringify(response, null, 2));
    
    if (activeModel.startsWith('o1')) {
      // Log the entire response structure for debugging
      logger.info('o1 Response structure:', {
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        firstChoice: JSON.stringify(response.choices?.[0]),
        messageStructure: response.choices?.[0]?.message ? 
          Object.keys(response.choices[0].message) : 'no message object',
        rawResponse: JSON.stringify(response)  // Add full response logging
      });

      // Check if we have a valid response
      if (!response?.choices?.[0]?.message?.content) {
        logger.error('Invalid o1 response:', {
          responseType: typeof response,
          hasChoices: !!response?.choices,
          choicesLength: response?.choices?.length,
          firstChoice: response?.choices?.[0],
          messageContent: response?.choices?.[0]?.message?.content,
          fullResponse: JSON.stringify(response)
        });
        throw new Error('Invalid or empty response from o1 model');
      }
    } else {
      if (!response?.choices?.[0]?.message?.content) {
        logger.error('OpenAI Response structure:', {
          response: response,
          hasChoices: !!response?.choices,
          choicesLength: response?.choices?.length,
          hasMessage: !!response?.choices?.[0]?.message,
          content: response?.choices?.[0]?.message?.content
        });
        throw new Error('Invalid or empty response from OpenAI');
      }
    }

    let content;
    if (activeModel.startsWith('o1')) {
      content = response.choices[0].message.content;
    } else {
      content = response.choices[0].message.content;
    }

    const usage = response.usage;
    const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, activeModel);

    logger.info(`Generated article length: ${content.length} characters`);

    return {
      content,
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

const generateArticleWithAnthropic = async (topic, summaries, activeModel) => {
  const { anthropicClient, getAnthropicModelId } = require('./anthropic');
  const fullModelId = getAnthropicModelId(activeModel);
  logger.info(`Using Anthropic model: ${fullModelId} for article generation`);
  
  // Reuse existing source material preparation
  const localSources = summaries
    .filter(s => s.isLocal && s.content && s.content.trim().length > 0)
    .map(s => s.content);

  const hasValidLocalSources = localSources.length > 0;
  logger.info(`Found ${localSources.length} valid local sources`);

  const webSources = summaries
    .filter(s => !s.isLocal)
    .map(s => {
      let content = '';
      if (typeof s.content === 'string') {
        content = s.content;
      } else if (s.content && typeof s.content === 'object') {
        content = s.content.text || JSON.stringify(s.content);
      }
      return s.source && content ? `WEB SOURCE: ${s.source}\n${content}` : null;
    })
    .filter(Boolean);

  const sourceAnalysis = hasValidLocalSources ? await analyzeSourceRelevance(topic, localSources) : null;

  // Log source analysis results
  if (sourceAnalysis) {
    logger.info('*** Source analysis results:', {
      isRelevant: sourceAnalysis.isRelevant,
      mainTopic: sourceAnalysis.sourceThemes.mainTopic,
      concepts: sourceAnalysis.sourceThemes.concepts,
      technologies: sourceAnalysis.sourceThemes.technologies,
      applications: sourceAnalysis.sourceThemes.applications,
      suggestedFocus: sourceAnalysis.suggestedFocus
    });
  }

  // Use the same source context and requirements as OpenAI
  const sourceContext = hasValidLocalSources 
    ? `SOURCE HIERARCHY:
1. PRIMARY SOURCES: Direct, authoritative materials that must be heavily quoted and prioritized
2. WEB SOURCES: Supporting information to provide additional context only`
    : `SOURCE CONTEXT:
All sources are from web research and should be treated with equal weight`;

  const processSteps = hasValidLocalSources
    ? `1. First analyze PRIMARY SOURCES to identify key themes and verified facts
2. Then review WEB SOURCES for supporting context
3. Organize information prioritizing PRIMARY SOURCE content`
    : `1. Analyze all sources to identify key themes and verified facts
2. Cross-reference information across multiple sources when possible
3. Organize information into a coherent narrative`;

  const sourceMaterials = hasValidLocalSources 
    ? `PRIMARY SOURCE MATERIALS:\n${localSources.join("\n\n---\n\n")}\n\nSUPPORTING WEB RESEARCH:\n${webSources.join("\n\n---\n\n")}`
    : `SOURCE MATERIALS:\n${webSources.join("\n\n---\n\n")}`;

  const contextualGuidance = sourceAnalysis?.sourceThemes?.mainTopic 
    ? `CONTENT APPROACH:
- Primary source focuses on: ${sourceAnalysis.sourceThemes.mainTopic}
- Key concepts to incorporate: ${sourceAnalysis.sourceThemes.concepts.join(', ')}
- Use these concepts as analytical framework when examining ${topic}
- Draw connections while maintaining factual accuracy
- Clearly indicate when making comparative analyses`
    : '';

  try {
    logger.info('Sending request to Anthropic...');
    const response = await anthropicClient.messages.create({
      model: fullModelId,
      max_tokens: ARTICLE_MAX_TOKENS,
      messages: [{
        role: 'user',
        content: `TASK: Write an engaging web article about ${topic} based on the provided sources.

CONTEXT:
- Target audience: Web readers seeking informative, accessible content
- Purpose: Educate and inform while maintaining reader engagement
- Style: Conversational but authoritative

${sourceContext}

${contextualGuidance}

PROCESS:
${processSteps}
4. Write in clear, accessible language while maintaining accuracy
5. Include relevant quotes with proper attribution
6. Structure content for web readability

OUTPUT REQUIREMENTS:
1. Format: Clean Markdown with clear section headers
2. Length: Minimum 1700 words
3. Structure:
   - Engaging opening hook based on verified information
   - Clear section breaks with descriptive headers
   - Short, focused paragraphs
   - Natural transitions between ideas
   - Concluding "Key Takeaways" section

SOURCE MATERIALS:
${sourceMaterials}

Begin by analyzing the sources, then write the article following the process above while strictly adhering to the requirements.`
      }]
    });

    const usage = {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens
    };

    const cost = calculateCost(usage.prompt_tokens, usage.completion_tokens, activeModel);

    logger.info(`Generated article length: ${response.content.length} characters`);

    return {
      content: response.content,
      usage,
      cost
    };
  } catch (error) {
    logger.error('Error in Anthropic article generation:', error);
    throw error;
  }
};

module.exports = {
  generateArticle,
};

const Anthropic = require('@anthropic-ai/sdk');

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ANTHROPIC_MODELS = {
  // Claude 3.5 models
  'claude-3-5-sonnet': {
    modelId: 'claude-3-5-sonnet-20241022',
    input: 3.00 / 1000000,
    output: 15.00 / 1000000
  },
  'claude-3-5-haiku': {
    modelId: 'claude-3-5-haiku-20241022',
    input: 0.80 / 1000000,
    output: 4.00 / 1000000
  },
  // Claude 3 models
  'claude-3-sonnet': {
    modelId: 'claude-3-sonnet-20240229',
    input: 3.00 / 1000000,
    output: 15.00 / 1000000
  },
  'claude-3-haiku': {
    modelId: 'claude-3-haiku-20240307',
    input: 0.25 / 1000000,
    output: 1.25 / 1000000
  }
};

const getAnthropicModelId = (modelName) => {
  // If it's an exact match, use it
  if (ANTHROPIC_MODELS[modelName]) {
    return ANTHROPIC_MODELS[modelName].modelId;
  }

  // Handle shortened names
  const modelMap = {
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
    'claude-3-sonnet': 'claude-3-sonnet-20240229',
    'claude-3-haiku': 'claude-3-haiku-20240307'
  };

  const mappedModel = modelMap[modelName];
  if (mappedModel && ANTHROPIC_MODELS[mappedModel]) {
    return ANTHROPIC_MODELS[mappedModel].modelId;
  }

  return modelName;
};

module.exports = {
  anthropicClient,
  ANTHROPIC_MODELS,
  getAnthropicModelId
}; 
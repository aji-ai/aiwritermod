# Article Generation Tool (Modified)

This is based on [Kristian Freeman's aiwriter](https://github.com/kristianfreeman/aiwriter) and includes things I've been wanting to have around me.

## Getting Started

1. Install the required dependencies: `npm install`
2. Create a `.env` file and provide the necessary environment variables:
   ```
   cp .env.example .env
   ```
   Required API keys:
   - `OPENAI_API_KEY` - For GPT models
   - `ANTHROPIC_API_KEY` - For Claude models
   - `SUMMARY_MODEL` - Default model for summarization tasks (e.g., `gpt-4o-mini` for cost efficiency)
3. Run the application: `node index.js` or better yet `npm run fstart`

## Usage

**HTTP Server**: The application runs an HTTP server that listens for GET requests at the `/` endpoint with the following parameters:

- `keyword` (required): The search term or topic to generate content about; for multiple keywords use a + between them
- `model` (optional): The AI model to use for generation (see Models & Pricing below) as the real brains of this task
- `source_dir` (optional): Directory name under 'sources' to use for local content ingestion to guide the article

## Models & Pricing

| Model | Input Cost (per 1M tokens) | Output Cost (per 1M tokens) |
|-------|---------------------------|----------------------------|
| gpt-4o (default) | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| o1-mini | $3.00 | $12.00 |
| claude-3-5-sonnet | $3.00 | $15.00 |
| claude-3-5-haiku | $0.80 | $4.00 |
| claude-3-sonnet | $3.00 | $15.00 |
| claude-3-haiku | $0.25 | $1.25 |

## Examples

Using web search only:

curl "http://localhost:5139/?keyword=openai+latest&model=o1-mini" 

Using local sources:

curl "http://localhost:5139/?keyword=hiroshi+ishii+teleabsence&model=claude-3-5-sonnet&source_dir=ishii"

The local sources should be organized as:

```
sources/
  ishii/
    ishii-1.md
    ishii-2.md
    ishii-3.md
```

The model will read all the files in the directory and the article will be heavily influenced by the content of the files.

## Output Format

The API returns a JSON response with the following structure:

```
json
{
    "keyword": "your-search-term",
    "article": {
    "content": "The generated article in markdown format",
    "usage": {
        "prompt_tokens": 123,
        "completion_tokens": 456,
        "total_tokens": 579
    },
    "cost": {
        "inputCost": 0.000123,
        "outputCost": 0.000456,
        "totalCost": 0.000579
    }
    },
    "usage": {
        "model": "gpt-4o",
        "input_tokens": 1000,
        "output_tokens": 2000,
        "total_tokens": 3000,
        "estimated_cost": 0.00123
    },
    "summary_usage": {
        "input_tokens": 500,
        "output_tokens": 800,
        "total_tokens": 1300,
        "estimated_cost": 0.00065
    }
}
```

If there's an error:

```
{
"keyword": "your-search-term",
"error": "Error message describing what went wrong"
}
```
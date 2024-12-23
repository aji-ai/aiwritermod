# Article Generation Tool (Modified)

This is based on [Kristian Freeman's aiwriter](https://github.com/kristianfreeman/aiwriter) and includes things I've been wanting to have around me.

## Getting Started

1. Install the required dependencies: `npm install`
2. Create a `.env` file and provide the necessary environment variables (e.g., API keys, credentials): `cp .env.example .env` and fill it out
4. Run the application: `node index.js`

## Usage

**HTTP Server**: The application runs an HTTP server that listens for GET requests at the `/` endpoint with the following parameters:

- `keyword` (required): The search term or topic to generate content about
- `model` (optional): The AI model to use for generation. Available options:
  - `gpt-4o` (default)
  - `gpt-4o-mini`
  - `o1-mini`
- `source_dir` (optional): Directory name under 'sources' to use for local content ingestion
- `use_web` (optional): Set to "false" to disable web search and only use local sources

## Example

Just use the web

```
curl "http://localhost:5139/?keyword=openai+latest&model=o1-mini"
```

Use local sources (ingests all files in the 'sources' subdirectory)

```
curl "http://localhost:5139/?keyword=hiroshi+ishii+teleabsence&model=gpt-4o&source_dir=ishii"
```

In this example in the directory `sources/ishii` there are files that will be ingested and used to generate the article. That looks in a file system like:

```
sources/
  ishii/
    ishii-1.md
    ishii-2.md
    ishii-3.md
```

It's best to give it markdown files right now.

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
    }
}
```


Costs are calculated based on the model used (https://openai.com/pricing/ in 2024)

| Model | Input Cost (per 1M tokens) | Output Cost (per 1M tokens) |
|-------|---------------------------|----------------------------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| o1-mini | $3.00 | $12.00 |

If there's an error, the response will look like:

```
json
{
"keyword": "your-search-term",
"error": "Error message describing what went wrong"
}
```

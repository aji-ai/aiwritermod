const logger = require('pino')()
require('dotenv').config();
const cheerio = require('cheerio');
const fs = require('fs');
const google = require('googlethis');
const openai = require('openai');
const wordcount = require('word-count');

const keyword = process.argv[2];
const client = new openai.OpenAI(process.env.OPENAI_API_KEY);

function pbcopy(data) {
  var proc = require('child_process').spawn('pbcopy');
  proc.stdin.write(data); proc.stdin.end();
}

const queryGoogle = async (keyword) => {
  const search = await google.search(keyword);
  return search.results.slice(0, 5)
}

const summarizeContent = async (url) => {
  const html = await fetch(url);
  const text = await html.text();

  const $ = cheerio.load(text);
  const body = $('h1, h2, h3, h4, h5, h6, p');

  const content = `
    Parse the output of the following HTML and return the content of the article.

    ${body.text().slice(0, 14000)}
  `

  const example = `
    Title: (title of page)
    
    Summary:
      - Heading 1
        - Heading 2
          - (content)
        - Heading 2
          - Heading 3
            - (content)
  `

  const messages = [
    { role: "system", content: "Act as a helpful program that can accurately return the contents of an article." },
    { role: "user", content: "Parse the output of the following HTML and return the content of the article." },
    { role: "assistant", content: example },
    { role: 'user', content }
  ]

  const response = await client.chat.completions.create({
    model: 'gpt-3.5-turbo-16k',
    messages
  })

  return response.choices[0].message;
}

const generateTitles = async (keyword) => {
  const content = `
    Generate 10 SEO-optimized titles for the following keyword: ${keyword}.
  `

  const response = await client.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'user', content }
    ]
  })

  const message = response.choices[0].message;
  return message.content
}

const generateArticle = async (topic, summaries) => {
  const summariesAsText = summaries.map(summary => summary.content)

  const currentToken = 0;

  const minimumWordCount = 1700;

  const content = `
    Write an article about the following topic: ${topic}. 

    Generate an SEO-optimized title for the blog post. The title must not be one of the titles of the articles that you are summarizing.
    
    Use the following contents of similar articles to construct the article. Do not repeat the same content. Use a tone that is appropriate for a blog post. The article should be SEO-optimized. The article must be more than ${minimumWordCount} words. It must be formatted as Markdown.
    
    In the introductory paragraph, introduce the topic and the main points of the article. Also, declaratively answer any questions that the reader may have in a format that is Google SEO-friendly. Generate Markdown links as often as possible for anything that should be linked to.

    You must always provide the following things in the blog post:

    - Key takeaways
    - A declarative answer to the question "(topic)?"
    - A step-by-step guide to (topic)
    - Who is (topic) for?
    
    In the body, elaborate on the main points. Each section indicated by an h2 header must contain at least 100 words. In the conclusion, summarize the main points and provide a call to action.

    The blog post will be longer than you are able to generate in a single request. Generate the article in increments of 1000 tokens. Start at token ${currentToken}. When you are done, add the text "$COMPLETED" to the end of the article.

    ${summariesAsText.join('\n')}

    Do not repeat any of the content you have already generated. If you do, you will be penalized.
  `

  let finalContent = ""

  while (wordcount(finalContent) < minimumWordCount) {
    const response = await client.chat.completions.create({
      model: 'gpt-3.5-turbo-16k',
      messages: [
        { role: "system", content: `Act as a writer creating SEO-optimized articles for a blog. You must generate at least ${minimumWordCount - wordcount(finalContent)} more words.` },
        { role: 'user', content }
      ]
    })

    const message = response.choices[0].message;

    finalContent += message.content;

    if (message.content.includes('$COMPLETED')) {
      break;
    }

    logger.info(`${wordcount(finalContent)} words generated, continuing...`)
  }

  finalContent = finalContent.replace('$COMPLETED', '');

  return finalContent;
}

const main = async () => {
  if (!keyword) {
    logger.info('Please provide a keyword');
    return;
  }

  const results = await queryGoogle(keyword);

  let summaries = [];

  for (const result of results) {
    logger.info(`PROCESSING "${result.title} - ${result.url}"`);
    const summary = await summarizeContent(result.url);
    summaries.push(summary);
  }
  logger.info(`Summarized ${summaries.length} articles. Generating article...`)

  const article = await generateArticle(keyword, summaries);
  logger.info(`Article generated. ${wordcount(article)} words`)

  fs.writeFileSync(`./articles/${keyword}.md`, article);
  logger.info(`Article saved to ./articles/${keyword}.md`)

  pbcopy(article);
  logger.info('Article copied to clipboard')

  const titles = await generateTitles(keyword);
  logger.info(`Titles generated: \n${titles}`)

  logger.info('DONE')
}

main()
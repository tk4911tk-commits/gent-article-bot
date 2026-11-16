import axios from 'axios';
import fs from 'fs';
import path from 'path';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

const HISTORY_PATH = path.join(process.cwd(), 'data', 'topic-history.json');
const HISTORY_KEEP_COUNT = 40; // 直近40件（だいたい10〜13週分）を保持

function loadLearningArticles() {
  const articlesPath = path.join(process.cwd(), 'data', 'learning-articles.md');
  return fs.readFileSync(articlesPath, 'utf-8');
}

function loadTopicHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(HISTORY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('History load error (continuing with empty history):', error.message);
    return [];
  }
}

function saveTopicHistory(history, newTopics, weekLabel) {
  const additions = newTopics.map(function (topic) {
    return {
      week: weekLabel,
      title: topic.title,
      genre: topic.genre,
      style: topic.style
    };
  });

  const merged = history.concat(additions);
  const trimmed = merged.slice(Math.max(0, merged.length - HISTORY_KEEP_COUNT));

  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
}

function formatHistoryForPrompt(history) {
  if (history.length === 0) {
    return '（まだ過去の履歴はありません）';
  }

  // 直近15件だけプロンプトに含める（プロンプトが長くなりすぎないように）
  const recent = history.slice(Math.max(0, history.length - 15));

  return recent.map(function (item, index) {
    return (index + 1) + '. 【' + item.genre + '／' + item.style + '】' + item.title;
  }).join('\n');
}

function countGenreUsage(history) {
  const counts = {};
  history.forEach(function (item) {
    counts[item.genre] = (counts[item.genre] || 0) + 1;
  });
  return counts;
}

async function generateTopicPool() {
  const learningArticles = loadLearningArticles();
  const history = loadTopicHistory();
  const historyText = formatHistoryForPrompt(history);
  const genreCounts = countGenreUsage(history);
  const genreCountsText = Object.keys(genreCounts).length > 0
    ? Object.entries(genreCounts).map(function (entry) {
        return entry[0] + '：' + entry[1] + '回';
      }).join('、')
    : '（まだ記録なし）';

  const systemPrompt = [
    'あなたはGENTの記事執筆アシスタントです。',
    '恋愛コーチング領域で、生徒さんが「なるほど！」と思える実践的なトピックを提案します。',
    '',
    '【重要な指示】',
    '- トーン：営業コンサル視点（ビジネス理論×恋愛）は使いすぎない。他の切り口（心理学、行動経済学、具体的エピソード、Q&A形式、データ・あるある統計形式など）も積極的に試す',
    '- 既存の3つの文体パターン（運営者風・舞香風・百足風）を参考にしつつ、内容の切り口は毎回変える',
    '- 新ジャンル「性（キス・SEXなど）」は運営者風で提案してよい',
    '- 各トピックに簡潔な構成骨子も含める',
    '- 必ずJSON形式のみで返答してください。JSON以外の説明文、前置き、後書きは一切含めないでください。',
    '',
    '【絶対に守ること：マンネリ防止】',
    '- 下記の「直近に提案したトピック一覧」と、タイトル・切り口・構成パターンが似ているものは絶対に提案しないこと',
    '- 特に「余裕」「安心感」「テクニックより〇〇」「義務感」「既読スルー」という結論に逃げがちなので、今回はこれらの結論パターンを使わないこと',
    '- 各ジャンルの使用回数（下記）を見て、使用回数が少ないジャンルを優先的に選ぶこと',
    '',
    '【直近に提案したトピック一覧（新しい順）】',
    historyText,
    '',
    '【ジャンル別・使用回数】',
    genreCountsText,
    '',
    '【学習教材（文体・構成の参考。内容そのものを真似しない）】',
    learningArticles
  ].join('\n');

  const userPrompt = [
    'この週のGENT記事トピック池を作成してください。',
    '',
    '【要件】',
    '- トピック数：3-4本',
    '- ジャンル：会話、身だしなみ、LINE、実話、性（キス・SEXなど）から選択。直近の履歴を踏まえてバランスよく',
    '- 各トピックに：',
    '  * タイトル（直近の履歴と似た言い回し・結論にしないこと）',
    '  * 簡潔な構成（見出し3-4個）',
    '  * 推奨文体（運営者風/舞香風/百足風）',
    '  * 短い説明',
    '',
    '【出力形式】',
    '以下のJSON構造のみを出力してください。説明文は不要です：',
    '{',
    '  "week": "2024-XX-XX",',
    '  "topics": [',
    '    {',
    '      "id": 1,',
    '      "title": "タイトル",',
    '      "genre": "性",',
    '      "style": "運営者風",',
    '      "outline": ["見出し1", "見出し2", "見出し3"],',
    '      "description": "このトピックの狙い"',
    '    }',
    '  ]',
    '}'
  ].join('\n');

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        temperature: 1,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const textBlock = response.data.content.find(function (block) {
      return block.type === 'text';
    });

    if (!textBlock || !textBlock.text) {
      console.error('Full response:', JSON.stringify(response.data, null, 2));
      throw new Error('No text content found in Claude response');
    }

    const content = textBlock.text;

    console.log('--- Claude raw response start ---');
    console.log(content);
    console.log('--- Claude raw response end ---');

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('JSON not found in Claude response');
    }

    return { topicData: JSON.parse(jsonMatch[0]), history: history };
  } catch (error) {
    console.error('Claude API error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

function formatTopicsForLine(topicData) {
  const messages = [];

  messages.push({
    type: 'text',
    text: '📌 今週のトピック池\n\n今週のおすすめ記事トピック ' + topicData.topics.length + ' 本です。どれで執筆しますか？'
  });

  topicData.topics.forEach(function (topic, index) {
    const outlineText = topic.outline.map(function (o, i) {
      return '  ' + (i + 1) + '. ' + o;
    }).join('\n');

    const message = '【' + (index + 1) + '】' + topic.title + '\n\n' +
      '📂 ジャンル：' + topic.genre + '\n' +
      '🎨 文体：' + topic.style + '\n\n' +
      '📋 構成案：\n' + outlineText + '\n\n' +
      '💡 ' + topic.description;

    messages.push({
      type: 'text',
      text: message
    });
  });

  messages.push({
    type: 'text',
    text: '\n👉 「①で」「②で」など、番号で返信してください！'
  });

  return messages;
}

async function sendToLine(messages) {
  try {
    for (const msg of messages) {
      await axios.post(
        'https://api.line.me/v2/bot/message/broadcast',
        {
          messages: [
            {
              type: 'text',
              text: msg.text
            }
          ]
        },
        {
          headers: {
            'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        }
      );

      await new Promise(function (resolve) {
        setTimeout(resolve, 300);
      });
    }

    console.log('✅ Sent ' + messages.length + ' messages to LINE (broadcast)');
  } catch (error) {
    console.error('LINE API error:', error.message);
    if (error.response) {
      console.error('LINE error details:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 Starting weekly topic generation...');

    console.log('📝 Generating topics with Claude...');
    const result = await generateTopicPool();
    const topicData = result.topicData;
    const history = result.history;

    console.log('📋 Formatting messages for LINE...');
    const lineMessages = formatTopicsForLine(topicData);

    console.log('📤 Sending to LINE...');
    await sendToLine(lineMessages);

    console.log('💾 Saving topic history...');
    const weekLabel = new Date().toISOString().split('T')[0];
    saveTopicHistory(history, topicData.topics, weekLabel);

    const logPath = path.join(process.cwd(), 'logs', 'topic-pool-' + weekLabel + '.json');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify(topicData, null, 2));

    console.log('✅ Completed successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

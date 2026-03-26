const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const projectPath = process.env.LAVS_PROJECT_PATH || '.';
const dataFile = path.join(projectPath, 'data', 'presentation.json');
const configFile = path.join(projectPath, 'data', 'config.json');

function getConfig() {
  try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); }
  catch { return {}; }
}

function saveConfig(config) {
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  return config;
}

function getApiKey() {
  const config = getConfig();
  return config.geminiApiKey || process.env.GEMINI_API_KEY || '';
}

const STYLES = [
  { id: 'minimal-modern', name: '现代简约 (Modern Minimal)', description: '线条干净，留白充足，商务且清新。', previewColor: 'bg-slate-100', fontFamily: 'font-sans', promptModifier: '极简主义风格，干净的白色背景，柔和的阴影，企业孟菲斯风格，高调照明，清晰的中文排版，专业PPT幻灯片' },
  { id: 'hand-drawn', name: '创意手绘 (Creative Hand-Drawn)', description: '黑板报、草图、涂鸦风格，富有创意和亲和力。', previewColor: 'bg-stone-100', fontFamily: 'font-sans', promptModifier: '手绘草图风格，马克笔质感，思维导图元素，涂鸦，创意，白板或纸张纹理背景，活泼，艺术感，清晰的手写体中文排版' },
  { id: 'cyber-dark', name: '赛博科技 (Cyber Dark)', description: '未来感，霓虹点缀，深色背景。', previewColor: 'bg-slate-900', fontFamily: 'font-mono', promptModifier: '赛博朋克风格，霓虹灯光，深色背景，科技感，发光电路，未来UI元素，高科技数据可视化，清晰的中文排版' },
  { id: 'nature-organic', name: '自然有机 (Organic Nature)', description: '柔和的绿色，大地色调，自然纹理。', previewColor: 'bg-green-50', fontFamily: 'font-serif', promptModifier: '自然风格，有机形态，柔和焦外成像，树叶，大地色调，阳光，宁静，杂志排版风格，清晰的中文排版' },
  { id: 'bold-geometric', name: '大胆几何 (Bold Geometric)', description: '鲜艳的色彩，锐利的形状，抽象艺术。', previewColor: 'bg-blue-600', fontFamily: 'font-sans', promptModifier: '抽象几何形状，包豪斯风格，鲜艳的原色，锐利边缘，现代艺术海报风格，扁平化设计，清晰的中文排版' },
  { id: 'luxury-gold', name: '黑金奢华 (Luxury Gold)', description: '黑金配色，优雅，衬线字体。', previewColor: 'bg-neutral-900', fontFamily: 'font-serif', promptModifier: '奢华风格，黑金配色，大理石纹理，优雅，高端，电影级布光，衬线字体排版，清晰的中文排版' },
  { id: 'retro-vintage', name: '复古经典 (Retro Vintage)', description: '怀旧色调，旧纸张纹理，经典排版。', previewColor: 'bg-orange-100', fontFamily: 'font-serif', promptModifier: '复古怀旧风格，旧报纸纹理，暖黄色调，颗粒感，经典排版，胶片质感，清晰的中文排版' },
  { id: 'vibrant-pop', name: '活力波普 (Vibrant Pop)', description: '高饱和度，半色调网点，充满活力。', previewColor: 'bg-yellow-400', fontFamily: 'font-sans', promptModifier: '波普艺术风格，高饱和度色彩，半色调网点，大胆的线条，漫画元素，活力四射，清晰的中文排版' },
  { id: 'academic-rigor', name: '学术严谨 (Academic Rigor)', description: '黑白灰调，结构清晰，专业正式。', previewColor: 'bg-white', fontFamily: 'font-serif', promptModifier: '学术论文风格，严谨，黑白灰，简洁的线条，衬线字体，专业图表感，正式排版，清晰的中文排版' },
  { id: 'soft-pastel', name: '温柔粉彩 (Soft Pastel)', description: '马卡龙色系，柔和渐变，清新梦幻。', previewColor: 'bg-pink-50', fontFamily: 'font-sans', promptModifier: '马卡龙粉彩风格，柔和渐变，梦幻感，轻盈，清新，糖果色调，清晰的中文排版' },
  { id: 'industrial-tech', name: '工业科技 (Industrial Tech)', description: '混凝土质感，冷色调，硬朗结构。', previewColor: 'bg-zinc-800', fontFamily: 'font-mono', promptModifier: '工业风，混凝土纹理，金属拉丝，冷色调，结构化设计，硬朗，科技感，清晰的中文排版' },
  { id: 'japanese-zen', name: '日系禅意 (Japanese Zen)', description: '淡雅留白，和纸纹理，宁静自然。', previewColor: 'bg-stone-50', fontFamily: 'font-serif', promptModifier: '日系极简禅意，和纸纹理，留白，淡雅，自然光影，宁静，侘寂美学，清晰的中文排版' }
];

function loadPresentation() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
  catch { return null; }
}

function savePresentation(data) {
  const dir = path.dirname(dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  data.updatedAt = Date.now();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  return data;
}

function createEmptyPresentation(topic, styleId) {
  return {
    title: '',
    userInput: topic || '',
    styleId: styleId || 'minimal-modern',
    resolution: '2K',
    slides: [],
    sources: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); }
  catch { return {}; }
}

async function callGeminiText(model, systemInstruction, parts, tools) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('请先设置 Gemini API Key（通过对话告诉 Agent，或设置 GEMINI_API_KEY 环境变量）');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  if (tools) body.tools = tools;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }
  const json = await resp.json();
  const candidate = json.candidates?.[0];
  if (!candidate) throw new Error('No candidate in response');

  const text = candidate.content?.parts?.[0]?.text;
  const sources = [];
  const chunks = candidate.groundingMetadata?.groundingChunks;
  if (chunks) {
    chunks.forEach(c => { if (c.web) sources.push({ title: c.web.title, uri: c.web.uri }); });
  }
  return { text, sources };
}

async function callGeminiImage(title, body, styleModifier, resolution, referenceImageBase64, userInstruction) {
  const config = getConfig();
  const model = config.imageModel || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation';
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('请先设置 Gemini API Key');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const fullPrompt = `
    Role: Master Visual Designer & Information Architect.
    Task: Design a single 16:9 professional slide that communicates complex ideas through PURE VISUAL LANGUAGE and elegant layout.

    CONCEPTUAL CONTENT (Chinese Context):
    Core Concept: "${title}"
    Key Information Points: 
    """
    ${body.join('\n')}
    """

    ${userInstruction ? `VISUAL DIRECTION: "${userInstruction}"` : ''}

    ARTISTIC GUIDELINES:
    1. **VISUAL NARRATIVE**: Do NOT place large blocks of text on the slide. Instead, transform the "Key Information Points" into icons, data visualizations, symbolic imagery, or abstract metaphors.
    2. **SEMANTIC REPRESENTATION**: The design should allow the audience to understand the "Core Concept" instantly through visual cues alone. Use text only for the Main Title and essential keywords/captions.
    3. **LEGIBILITY & IMPACT**: Any keywords used must be integrated into the artistic design.
    4. **STYLE**: ${styleModifier}
    
    ${referenceImageBase64 ? `5. **AESTHETIC ADAPTATION**: Inherit the color palette and mood from the reference image, but use COMPLETE LAYOUT FREEDOM to fit this specific conceptual content.` : ''}
    
    OUTPUT: A single 16:9 cinematic presentation slide image.
  `;

  const parts = [{ text: fullPrompt }];
  if (referenceImageBase64) {
    const matches = referenceImageBase64.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      parts.push({ inlineData: { mimeType: matches[1], data: matches[2] } });
    }
  }

  const reqBody = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageSizeOptions: { aspectRatio: '16:9' }
    }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody)
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini Image API error ${resp.status}: ${err}`);
  }
  const json = await resp.json();
  const candidate = json.candidates?.[0];
  if (!candidate) throw new Error('No image candidate');

  for (const part of candidate.content.parts) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  throw new Error('No image in response');
}

async function handleGenerateOutline(input) {
  const { topic, slideCount = '8-12', styleId } = input;
  if (!topic) throw new Error('topic is required');

  const taskPrompt = `
    你是一位专业的演示文稿设计师和品牌策略师。请根据提供的主题，完成以下任务：
    
    1. 提炼标题：为一个演示文稿创建一个专业且有吸引力的标题。
    2. 创建大纲：创建一个逻辑流畅的结构（引言 -> 问题 -> 解决方案 -> 细节 -> 结论）。
    3. 视觉化构思：为每一页提供一个 "imageDescription"，描述如何通过视觉图形（而非文字）来表达该页的核心意义。
    
    目标页数: 大约 ${slideCount} 页。
    
    请以 JSON 格式回复：
    {
      "presentationTitle": "标题",
      "slides": [
        {
          "title": "页面标题",
          "body": ["要点1", "要点2"],
          "imageDescription": "视觉构想描述",
          "layout": "Title and Body",
          "speakerNotes": "演讲备注"
        }
      ]
    }
    
    layout 可选值: "Title", "Title and Body", "Two Column", "Image Focused", "Quote"
  `;

  const config = getConfig();
  const textModel = config.textModel || process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
  const result = await callGeminiText(
    textModel,
    '你是一个拥有强大调研能力的 PPT 策划专家。你会利用搜索工具整合最新信息，并以中文输出逻辑严密的大纲。',
    [{ text: `主题: ${topic}\n\n${taskPrompt}` }],
    [{ google_search: {} }]
  );

  const parsed = JSON.parse(result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  const pres = createEmptyPresentation(topic, styleId);
  pres.title = parsed.presentationTitle || '未命名演讲稿';
  pres.sources = result.sources || [];
  pres.slides = (parsed.slides || []).map(content => ({
    id: randomUUID(),
    content: {
      title: content.title || '',
      body: content.body || [],
      imageDescription: content.imageDescription || '',
      layout: content.layout || 'Title and Body',
      speakerNotes: content.speakerNotes || ''
    },
    imageUrl: null,
    imageHistory: []
  }));

  return savePresentation(pres);
}

async function handleRefineOutline(input) {
  const { instruction, slideCount } = input;
  if (!instruction) throw new Error('instruction is required');

  const pres = loadPresentation();
  if (!pres) throw new Error('No presentation exists yet');

  const currentOutline = pres.slides.map(s => ({ title: s.content.title, body: s.content.body }));
  const targetCount = slideCount || pres.slides.length.toString();

  const taskPrompt = `
    根据用户的修改请求，重新构建演示文稿大纲。
    当前大纲: ${JSON.stringify(currentOutline)}
    修改指令: "${instruction}"
    目标页数: ${targetCount}
    原始主题: "${pres.userInput}"
    
    请以 JSON 格式回复：
    {
      "presentationTitle": "标题",
      "slides": [
        {
          "title": "页面标题",
          "body": ["要点1", "要点2"],
          "imageDescription": "视觉构想描述",
          "layout": "Title and Body",
          "speakerNotes": "演讲备注"
        }
      ]
    }
  `;

  const config = getConfig();
  const textModel = config.textModel || process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
  const result = await callGeminiText(
    textModel,
    '你是一个 PPT 策划专家，根据用户指令优化大纲。',
    [{ text: taskPrompt }],
    [{ google_search: {} }]
  );

  const parsed = JSON.parse(result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
  pres.title = parsed.presentationTitle || pres.title;
  pres.sources = [...(pres.sources || []), ...(result.sources || [])];
  pres.slides = (parsed.slides || []).map(content => ({
    id: randomUUID(),
    content: {
      title: content.title || '',
      body: content.body || [],
      imageDescription: content.imageDescription || '',
      layout: content.layout || 'Title and Body',
      speakerNotes: content.speakerNotes || ''
    },
    imageUrl: null,
    imageHistory: []
  }));

  return savePresentation(pres);
}

async function handleGenerateImage(input) {
  const { slideIndex, instruction, useCurrentAsRef } = input;

  const pres = loadPresentation();
  if (!pres) throw new Error('No presentation exists');
  if (slideIndex < 0 || slideIndex >= pres.slides.length) throw new Error('Invalid slide index');

  const slide = pres.slides[slideIndex];
  const style = STYLES.find(s => s.id === pres.styleId) || STYLES[0];

  let refImage = useCurrentAsRef ? slide.imageUrl : null;
  if (!useCurrentAsRef && slideIndex > 0 && pres.slides[slideIndex - 1]?.imageUrl) {
    refImage = pres.slides[slideIndex - 1].imageUrl;
  }

  const b64 = await callGeminiImage(
    slide.content.title,
    slide.content.body,
    style.promptModifier,
    pres.resolution,
    refImage || undefined,
    instruction
  );

  const newVersion = {
    id: randomUUID(),
    url: b64,
    timestamp: Date.now(),
    title: slide.content.title,
    body: [...slide.content.body],
    userInstruction: instruction || '',
    referenceImageUrl: refImage || null
  };

  if (slide.imageUrl) {
    const history = slide.imageHistory || [];
    const lastInHistory = history.length > 0 ? history[history.length - 1].url : null;
    if (lastInHistory !== slide.imageUrl) {
      history.push({
        id: randomUUID(),
        url: slide.imageUrl,
        timestamp: Date.now() - 1000,
        title: slide.content.title,
        body: [...slide.content.body],
        userInstruction: 'Previous Version (Auto-saved)'
      });
    }
    slide.imageHistory = [...history, newVersion];
  } else {
    slide.imageHistory = [newVersion];
  }
  slide.imageUrl = b64;

  return savePresentation(pres);
}

async function handleGenerateAllImages(input) {
  const { startIndex = 0 } = input;

  let pres = loadPresentation();
  if (!pres) throw new Error('No presentation exists');

  const style = STYLES.find(s => s.id === pres.styleId) || STYLES[0];

  for (let i = startIndex; i < pres.slides.length; i++) {
    const slide = pres.slides[i];
    let refImage = null;
    if (i > 0 && pres.slides[i - 1]?.imageUrl) {
      refImage = pres.slides[i - 1].imageUrl;
    }

    try {
      const b64 = await callGeminiImage(
        slide.content.title,
        slide.content.body,
        style.promptModifier,
        pres.resolution,
        refImage || undefined,
        undefined
      );

      const newVersion = {
        id: randomUUID(),
        url: b64,
        timestamp: Date.now(),
        title: slide.content.title,
        body: [...slide.content.body],
        referenceImageUrl: refImage
      };

      if (slide.imageUrl) {
        const history = slide.imageHistory || [];
        const lastInHistory = history.length > 0 ? history[history.length - 1].url : null;
        if (lastInHistory !== slide.imageUrl) {
          history.push({
            id: randomUUID(),
            url: slide.imageUrl,
            timestamp: Date.now() - 1000,
            title: slide.content.title,
            body: [...slide.content.body],
            userInstruction: 'Previous Version (Auto-saved)'
          });
        }
        slide.imageHistory = [...history, newVersion];
      } else {
        slide.imageHistory = [newVersion];
      }
      slide.imageUrl = b64;

      pres = savePresentation(pres);
    } catch (err) {
      console.error(`Failed to generate image for slide ${i}: ${err.message}`);
    }
  }

  return pres;
}

const command = process.argv[2];

async function main() {
  try {
    let result;
    switch (command) {
      case 'get': {
        const pres = loadPresentation();
        result = pres || createEmptyPresentation('', 'minimal-modern');
        break;
      }
      case 'list-styles': {
        result = STYLES.map(({ promptModifier, ...rest }) => rest);
        break;
      }
      case 'get-config': {
        const config = getConfig();
        result = {
          hasApiKey: !!config.geminiApiKey,
          textModel: config.textModel || 'gemini-2.5-flash',
          imageModel: config.imageModel || 'gemini-2.0-flash-preview-image-generation'
        };
        break;
      }
      case 'set-config': {
        const input = readStdin();
        const config = getConfig();
        if (input.geminiApiKey !== undefined) config.geminiApiKey = input.geminiApiKey;
        if (input.textModel !== undefined) config.textModel = input.textModel;
        if (input.imageModel !== undefined) config.imageModel = input.imageModel;
        saveConfig(config);
        result = {
          success: true,
          hasApiKey: !!config.geminiApiKey,
          textModel: config.textModel || 'gemini-2.5-flash',
          imageModel: config.imageModel || 'gemini-2.0-flash-preview-image-generation'
        };
        break;
      }
      case 'generate-outline': {
        result = await handleGenerateOutline(readStdin());
        break;
      }
      case 'refine-outline': {
        result = await handleRefineOutline(readStdin());
        break;
      }
      case 'update-slide': {
        const input = readStdin();
        const pres = loadPresentation();
        if (!pres) throw new Error('No presentation');
        const { index, ...updates } = input;
        if (index < 0 || index >= pres.slides.length) throw new Error('Invalid index');
        const slide = pres.slides[index];
        if (updates.title !== undefined) slide.content.title = updates.title;
        if (updates.body !== undefined) slide.content.body = updates.body;
        if (updates.imageDescription !== undefined) slide.content.imageDescription = updates.imageDescription;
        if (updates.layout !== undefined) slide.content.layout = updates.layout;
        if (updates.speakerNotes !== undefined) slide.content.speakerNotes = updates.speakerNotes;
        result = savePresentation(pres);
        break;
      }
      case 'add-slide': {
        const input = readStdin();
        const pres = loadPresentation() || createEmptyPresentation('', 'minimal-modern');
        const newSlide = {
          id: randomUUID(),
          content: {
            title: input.title || '新幻灯片',
            body: input.body || ['点击此处编辑内容...'],
            imageDescription: input.imageDescription || '专业幻灯片背景',
            layout: 'Title and Body',
            speakerNotes: ''
          },
          imageUrl: null,
          imageHistory: []
        };
        const pos = input.index !== undefined ? input.index : pres.slides.length;
        pres.slides.splice(pos, 0, newSlide);
        result = savePresentation(pres);
        break;
      }
      case 'delete-slide': {
        const { index } = readStdin();
        const pres = loadPresentation();
        if (!pres) throw new Error('No presentation');
        if (index < 0 || index >= pres.slides.length) throw new Error('Invalid index');
        pres.slides.splice(index, 1);
        result = savePresentation(pres);
        break;
      }
      case 'move-slide': {
        const { index, direction } = readStdin();
        const pres = loadPresentation();
        if (!pres) throw new Error('No presentation');
        const target = index + direction;
        if (target < 0 || target >= pres.slides.length) throw new Error('Cannot move');
        const temp = pres.slides[index];
        pres.slides[index] = pres.slides[target];
        pres.slides[target] = temp;
        result = savePresentation(pres);
        break;
      }
      case 'set-style': {
        const input = readStdin();
        const pres = loadPresentation();
        if (!pres) throw new Error('No presentation');
        if (input.styleId) pres.styleId = input.styleId;
        if (input.resolution) pres.resolution = input.resolution;
        result = savePresentation(pres);
        break;
      }
      case 'generate-image': {
        result = await handleGenerateImage(readStdin());
        break;
      }
      case 'generate-all-images': {
        result = await handleGenerateAllImages(readStdin());
        break;
      }
      case 'export': {
        const { format } = readStdin();
        const pres = loadPresentation();
        if (!pres) throw new Error('No presentation');
        const slidesWithImages = pres.slides.filter(s => !!s.imageUrl);
        if (slidesWithImages.length === 0) throw new Error('没有可导出的已生成图片');

        const exportDir = path.join(projectPath, 'data');
        if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
        const fileName = `${pres.title || 'presentation'}.${format}`;
        const filePath = path.join(exportDir, fileName);

        if (format === 'pdf') {
          const htmlSlides = slidesWithImages.map((s, i) => {
            const imgTag = s.imageUrl ? `<img src="${s.imageUrl}" style="width:100%;height:100%;object-fit:contain;">` : '';
            return `<div style="page-break-after:always;width:1920px;height:1080px;background:#000;display:flex;align-items:center;justify-content:center;">${imgTag}</div>`;
          }).join('');
          fs.writeFileSync(filePath.replace('.pdf', '.html'), `<!DOCTYPE html><html><body style="margin:0;padding:0;">${htmlSlides}</body></html>`);
          result = { success: true, filePath: filePath.replace('.pdf', '.html'), message: '已导出为 HTML 文件（包含所有幻灯片图片），可用浏览器打印为 PDF' };
        } else {
          const imagesData = slidesWithImages.map((s, i) => ({
            index: i,
            title: s.content.title,
            imageUrl: s.imageUrl
          }));
          const exportData = { title: pres.title, slides: imagesData };
          fs.writeFileSync(filePath.replace('.pptx', '.json'), JSON.stringify(exportData, null, 2));
          result = { success: true, filePath: filePath.replace('.pptx', '.json'), message: '已导出幻灯片数据（含 base64 图片），可用于进一步处理' };
        }
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();

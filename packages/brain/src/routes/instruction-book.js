// 同一只读reader供现役ops路由与固定Docker制品使用；不导入DB/模型/执行器。
import {readFileSync as rfs, readdirSync as rds} from 'node:fs';
import pathMod from 'node:path';
import {fileURLToPath} from 'node:url';

function instructionDocsRoot() {
  // 容器声明不可变制品路径；源码默认只指向仓库同源目录，不搜索宿主或其它fallback。
  if (Object.hasOwn(process.env, 'INSTRUCTION_BOOK_DOCS_ROOT')) {
    const root = process.env.INSTRUCTION_BOOK_DOCS_ROOT;
    if (!pathMod.isAbsolute(root)) throw new Error('instruction docs root must be absolute');
    return root;
  }
  return fileURLToPath(new URL('../../../../docs/instruction-book/', import.meta.url));
}

function parseEntry(filePath, category) {
  const raw = rfs(filePath, 'utf-8');
  if (!raw.trim()) throw new Error('instruction entry is empty');
  const lines = raw.split('\n');

  // 提取 frontmatter id/version/changelog
  let id = '', version = '';
  const changelog = [];
  let inFrontmatter = false;
  let frontmatterDone = false;
  let inChangelogBlock = false;
  for (const line of lines) {
    if (line.trim() === '---') {
      if (!frontmatterDone) { inFrontmatter = !inFrontmatter; if (!inFrontmatter) frontmatterDone = true; }
      continue;
    }
    if (inFrontmatter) {
      if (line.match(/^changelog:\s*$/)) { inChangelogBlock = true; continue; }
      if (inChangelogBlock) {
        const item = line.match(/^\s+-\s+(.+)/);
        if (item) {
          const verDesc = item[1].match(/^(\d[\d.]+):\s*(.+)/);
          if (verDesc) changelog.push({ version: verDesc[1], description: verDesc[2].trim() });
          else changelog.push({ version: '', description: item[1].trim() });
        } else if (line.match(/^\S/)) {
          inChangelogBlock = false;
        }
      }
      if (!inChangelogBlock) {
        const m = line.match(/^(id|version):\s*(.+)/);
        if (m) { if (m[1] === 'id') id = m[2].trim(); else version = m[2].trim(); }
      }
    }
  }

  // 提取标题（第一个 # 行）
  const titleLine = lines.find(l => l.startsWith('# ') && !l.startsWith('## '));
  const title = titleLine ? titleLine.replace(/^# /, '').trim() : pathMod.basename(filePath, '.md');

  // 提取各章节内容（支持 ### 子章节）
  const sections = {};
  const subSections = {};
  let currentSection = null;
  let sectionLines = [];
  let currentSubSection = null;
  let subSectionLines = [];
  const sectionMap = {
    'What it is': 'what',
    'What': 'what',
    'Trigger': 'trigger',
    'How to use': 'howToUse',
    'Output': 'output',
    'Added in': 'addedIn',
  };

  // 仅兼容仓内实际15条目使用的章节名；英文键及现有前端结构保持不变。
  const chineseSectionMap = {
    '功能概述': 'what', '功能': 'what', '触发机制': 'trigger',
    '各阶段行为': 'howToUse', 'Rerun 行为': 'howToUse',
    'Fallback 机制': 'howToUse', 'Prompt 热更新': 'howToUse',
    'API 接口': 'howToUse', '核心文件': 'howToUse',
    '用途': 'howToUse', '参数': 'howToUse', '降级行为': 'howToUse',
    '数据表': 'output', '数据源': 'output',
    '端点': 'howToUse', '响应': 'output', '数据字段': 'output', '关联': 'howToUse',
    'API 端点': 'howToUse', '数据表结构': 'output', '使用场景': 'howToUse', 'Migration': 'output',
    '功能说明': 'what', '使用方式': 'howToUse', 'YAML 默认配置': 'howToUse',
    'Notebook 复用模式（清空后复用）': 'howToUse', 'API': 'howToUse',
    '日报内容': 'output', '存储与推送': 'output', '相关文件': 'howToUse',
    '四 Tab 结构': 'howToUse', '生成记录 Tab — 执行阶段详情（v1.1.0）': 'howToUse',
    'Design': 'howToUse', '核心模块': 'howToUse',
  };

  function flushSubSection() {
    if (currentSection && currentSubSection !== null) {
      if (!subSections[currentSection]) subSections[currentSection] = [];
      subSections[currentSection].push({ title: currentSubSection, content: subSectionLines.join('\n').trim() });
    }
    currentSubSection = null;
    subSectionLines = [];
  }

  function flushSection() {
    flushSubSection();
    if (currentSection) {
      // 同类章节保留早先英文正文，后续中文子章不能用空content覆盖它。
      const content = sectionLines.join('\n').trim();
      sections[currentSection] = [sections[currentSection], content].filter(Boolean).join('\n\n');
    }
  }

  let inCodeFence = false;
  for (const line of lines) {
    // 真实说明书含Markdown模板；围栏中的##只是示例文字，不是新章节。
    const fence = line.trimStart().startsWith('```');
    if (fence || inCodeFence) {
      if (currentSection) (currentSubSection !== null ? subSectionLines : sectionLines).push(line);
      if (fence) inCodeFence = !inCodeFence;
      continue;
    }
    if (line.startsWith('## ')) {
      flushSection();
      const header = line.replace(/^## /, '').trim();
      currentSection = sectionMap[header] || chineseSectionMap[header] || null;
      sectionLines = [];
      // 现存中文说明保留真实章节名；多个同类章节作为UI已有subsections合并，不覆盖前文。
      if (chineseSectionMap[header] && !['what', 'trigger'].includes(currentSection)) {
        currentSubSection = header;
      }
    } else if (line.startsWith('### ') && currentSection) {
      flushSubSection();
      currentSubSection = line.replace(/^### /, '').trim();
    } else if (currentSection) {
      if (currentSubSection !== null) subSectionLines.push(line);
      else sectionLines.push(line);
    }
  }
  flushSection();

  // 将子章节合并到 sections
  const sectionsWithSub = {};
  for (const [key, content] of Object.entries(sections)) {
    sectionsWithSub[key] = { content, subsections: subSections[key] || [] };
  }

  return { id: id || `${category}:${pathMod.basename(filePath, '.md')}`, version, changelog, title, category, sections: sectionsWithSub };
}

function readCategory(docsRoot, subDir, categoryName) {
  const dir = pathMod.join(docsRoot, subDir);
  return rds(dir).filter(f => f.endsWith('.md'))
    .map(f => parseEntry(pathMod.join(dir, f), categoryName));
}

// HTTP消费者和镜像构建期自检读取同一真身；目录/正文损坏直接抛错。
export function readInstructionBook() {
  const root = instructionDocsRoot();
  return {skills: readCategory(root, 'skills', 'skill'), features: readCategory(root, 'features', 'feature')};
}

export function registerInstructionBookRoute(router) {
  router.get('/docs/instruction-book', (_req, res) => {
    try {
      res.json(readInstructionBook());
    } catch {
      // 缺失、不可读或损坏不是合法空目录；不把部分结果作为成功返回。
      res.status(503).json({error:'instruction_book_unavailable'});
    }
  });
}

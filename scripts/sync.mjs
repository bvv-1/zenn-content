import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const root = path.resolve(import.meta.dirname, '..');

try {
  process.loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const sourceDir = process.env.OBSIDIAN_ARTICLES_DIR
  ? path.resolve(process.env.OBSIDIAN_ARTICLES_DIR)
  : '';
const articlesDir = path.join(root, 'articles');
const imagesDir = path.join(root, 'images');
const manifestPath = path.join(root, '.sync-manifest.json');

if (!sourceDir || !path.isAbsolute(sourceDir)) {
  throw new Error('OBSIDIAN_ARTICLES_DIR に絶対パスを設定してください');
}

const sourceStat = await fs.stat(sourceDir).catch(() => null);
if (!sourceStat?.isDirectory()) throw new Error(`原稿フォルダが見つかりません: ${sourceDir}`);

await Promise.all([
  fs.mkdir(articlesDir, { recursive: true }),
  fs.mkdir(imagesDir, { recursive: true }),
]);

const previous = JSON.parse(await fs.readFile(manifestPath, 'utf8').catch(() => '{"files":[]}'));
const generated = [];
const entries = await fs.readdir(sourceDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
  const sourcePath = path.join(sourceDir, entry.name);
  const parsed = matter(await fs.readFile(sourcePath, 'utf8'));
  const status = parsed.data.status;
  if (status !== 'writing' && status !== 'published') continue;

  const slug = String(parsed.data.zenn_slug || '');
  if (!/^[a-z0-9_-]{12,50}$/.test(slug)) {
    throw new Error(`${entry.name}: zenn_slug は英小文字・数字・ハイフン・アンダースコアの12〜50文字にしてください`);
  }
  if (!String(parsed.data.title || '').trim()) throw new Error(`${entry.name}: title がありません`);
  if (!['tech', 'idea'].includes(parsed.data.type)) throw new Error(`${entry.name}: type は tech または idea にしてください`);

  const topics = Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String).slice(0, 5) : [];
  let body = parsed.content.replace(/\]\(images\//g, '](/images/');
  for (const match of parsed.content.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const reference = match[1].split('|')[0];
    const fileName = path.basename(reference);
    const articleImage = path.join(sourceDir, 'images', slug, fileName);
    const vaultImage = path.join(sourceDir, '..', reference);
    const sourceImage = (await fs.stat(articleImage).catch(() => null))?.isFile()
      ? articleImage
      : vaultImage;
    if (!(await fs.stat(sourceImage).catch(() => null))?.isFile()) {
      throw new Error(`${entry.name}: 画像が見つかりません: ${reference}`);
    }
    const relativeImage = path.join('images', slug, fileName);
    if (sourceImage === vaultImage) {
      await fs.mkdir(path.join(imagesDir, slug), { recursive: true });
      await fs.copyFile(sourceImage, path.join(root, relativeImage));
      generated.push(relativeImage);
    }
    body = body.replace(match[0], `![${path.parse(fileName).name}](/images/${slug}/${fileName})`);
  }
  const output = matter.stringify(body.trimStart(), {
    title: String(parsed.data.title),
    emoji: String(parsed.data.emoji || '📝'),
    type: parsed.data.type,
    topics,
    published: status === 'published',
    ...(parsed.data.published_at ? { published_at: parsed.data.published_at } : {}),
    ...(parsed.data.publication_name ? { publication_name: parsed.data.publication_name } : {}),
  });
  const relativePath = path.join('articles', `${slug}.md`);
  await fs.writeFile(path.join(root, relativePath), output, 'utf8');
  generated.push(relativePath);
}

const sourceImages = path.join(sourceDir, 'images');
const imageEntries = await fs.readdir(sourceImages, { recursive: true, withFileTypes: true }).catch(() => []);
for (const entry of imageEntries) {
  if (!entry.isFile()) continue;
  if (!/\.(?:png|jpe?g|gif|webp|svg|avif)$/i.test(entry.name)) continue;
  const relativeParent = path.relative(sourceImages, entry.parentPath);
  const relativePath = path.join('images', relativeParent, entry.name);
  const destination = path.join(root, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(path.join(entry.parentPath, entry.name), destination);
  generated.push(relativePath);
}

for (const relativePath of previous.files || []) {
  if (!generated.includes(relativePath)) await fs.rm(path.join(root, relativePath), { force: true });
}

await fs.writeFile(manifestPath, `${JSON.stringify({ files: generated.sort() }, null, 2)}\n`, 'utf8');
console.log(`${generated.filter((file) => file.startsWith('articles/')).length}件の記事を同期しました`);

import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import { XMLParser } from 'fast-xml-parser';

const RAW_FEEDS_DIR = path.resolve('./src/data/raw-feeds');
const OUTPUT_FILE = path.resolve('./src/data/master-products.json');

let masterProducts = [];

// --- Ο ΕΝΙΣΧΥΜΕΝΟΣ ΕΓΚΕΦΑΛΟΣ ΤΑΞΙΝΟΜΗΣΗΣ ---
function enrichProductData(title, category, description) {
  const rawText = `${title || ''} ${category || ''} ${description || ''}`;

  // Αφαιρούμε τόνους και τα κάνουμε πεζά
  const text = rawText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  let material = 'other';
  // Έβαλα πάρα πολλές εναλλακτικές λέξεις για να μην ξεφεύγει τίποτα
  if (
    text.includes('hpl') ||
    text.includes('laminate') ||
    text.includes('βακελιτ') ||
    text.includes('cpl')
  )
    material = 'hpl';
  else if (
    text.includes('μελαμιν') ||
    text.includes('melamine') ||
    text.includes('mfc') ||
    text.includes('επιφανει')
  )
    material = 'melamine';
  else if (
    text.includes('mdf') ||
    text.includes('λακα') ||
    text.includes('laka') ||
    text.includes('ακρυλικ') ||
    text.includes('pet')
  )
    material = 'mdf';
  else if (
    text.includes('μασιφ') ||
    text.includes('καπλαμα') ||
    text.includes('wood') ||
    text.includes('ξυλο') ||
    text.includes('veneer')
  )
    material = 'wood';

  let usage = 'other';
  if (
    text.includes('κουζιν') ||
    text.includes('παγκο') ||
    text.includes('πορτακι') ||
    text.includes('kitchen') ||
    text.includes('postforming')
  )
    usage = 'kitchen';
  else if (
    text.includes('ντουλαπ') ||
    text.includes('wardrobe') ||
    text.includes('closet') ||
    text.includes('συρομεν')
  )
    usage = 'wardrobe';

  return { material, usage };
}

// --- 1. Alfawood ---
function parseAlfawoodCSV() {
  return new Promise((resolve, reject) => {
    const filePath = path.join(RAW_FEEDS_DIR, 'Alfawood Data.csv');
    if (!fs.existsSync(filePath)) return resolve();
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', row => {
        const enrichment = enrichProductData(
          row.Title,
          row['Product categories'],
          row['Short Description']
        );
        masterProducts.push({
          id: `ALFA-${row.ID}`,
          title: row.Title,
          description: row['Short Description'] || '',
          category: row['Product categories'] || 'Χωρίς Κατηγορία',
          image: row['Image URL'] || '',
          supplier: 'Alfawood',
          material: enrichment.material,
          usage: enrichment.usage
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });
}

// --- 2. Decostar ---
async function parseDecostarXML() {
  const filePath = path.join(RAW_FEEDS_DIR, 'DecoStar.xml');
  if (!fs.existsSync(filePath)) return;
  const xmlData = await fs.readFile(filePath, 'utf8');
  const parser = new XMLParser();
  const jsonObj = parser.parse(xmlData);
  let productsArray = jsonObj.products?.product || jsonObj.product || [];
  if (!Array.isArray(productsArray)) productsArray = [productsArray];

  productsArray.forEach(item => {
    if (!item) return;
    let cat = item.categories?.category
      ? Array.isArray(item.categories.category)
        ? item.categories.category.join(', ')
        : item.categories.category
      : 'Χωρίς Κατηγορία';
    const enrichment = enrichProductData(item.title, cat, item.description);

    masterProducts.push({
      id: `DECO-${item.sku}`,
      title: item.title,
      description: item.description || '',
      category: cat,
      image: item.image || '',
      supplier: 'Decostar',
      material: enrichment.material,
      usage: enrichment.usage
    });
  });
}

// --- 3. Bensios ---
async function parseBensiosXML() {
  const filePath = path.join(RAW_FEEDS_DIR, 'Bensios.xml');
  if (!fs.existsSync(filePath)) return;
  const xmlData = await fs.readFile(filePath, 'utf8');
  const jsonObj = new XMLParser().parse(xmlData);
  let productsArray = jsonObj.data?.product || jsonObj.product || [];
  if (!Array.isArray(productsArray)) productsArray = [productsArray];

  productsArray.forEach(item => {
    if (!item) return;
    let firstImage =
      item.ImageURL && typeof item.ImageURL === 'string'
        ? item.ImageURL.split('|')[0]
        : '';
    const cat = item.Κατηγορίεςπροϊόντων || 'Χωρίς Κατηγορία';
    const enrichment = enrichProductData(item.Title, cat, item.Content);

    masterProducts.push({
      id: `BEN-${item.ID || Math.random()}`,
      title: item.Title || 'Χωρίς Τίτλο',
      description: item.Content || '',
      category: cat,
      image: firstImage,
      supplier: 'Bensios',
      material: enrichment.material,
      usage: enrichment.usage
    });
  });
}

// --- 4. Eleftheriou ---
async function parseEleftheriouXML() {
  const filePath = path.join(RAW_FEEDS_DIR, 'Eleftheriou.xml');
  if (!fs.existsSync(filePath)) return;
  const xmlData = await fs.readFile(filePath, 'utf8');
  const jsonObj = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  }).parse(xmlData);
  let itemsArray = jsonObj.rss?.channel?.item || [];
  if (!Array.isArray(itemsArray)) itemsArray = [itemsArray];

  itemsArray.forEach(item => {
    if (!item || item['wp:post_type'] !== 'product') return;
    let cat = 'Χωρίς Κατηγορία';
    if (item.category) {
      const categories = Array.isArray(item.category)
        ? item.category
        : [item.category];
      const productCats = categories.filter(
        c => c['@_domain'] === 'product_cat'
      );
      if (productCats.length > 0)
        cat = productCats.map(c => c['#text']).join(', ');
    }
    const enrichment = enrichProductData(
      item.title,
      cat,
      item['content:encoded']
    );

    masterProducts.push({
      id: `ELEF-${item['wp:post_id']}`,
      title: item.title || 'Χωρίς Τίτλο',
      description: item['content:encoded'] || '',
      category: cat,
      image: '',
      supplier: 'Eleftheriou',
      material: enrichment.material,
      usage: enrichment.usage
    });
  });
}

// --- 5. Praxitelis ---
async function parsePraxitelisXML() {
  const filePath = path.join(RAW_FEEDS_DIR, 'Praxitelis Products.xml');
  if (!fs.existsSync(filePath)) return;
  const xmlData = await fs.readFile(filePath, 'utf8');
  const jsonObj = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true
  }).parse(xmlData);
  let rows = jsonObj.Workbook?.Worksheet?.Table?.Row || [];
  if (!Array.isArray(rows)) rows = [rows];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i]?.Cell;
    if (!Array.isArray(cells) || cells.length < 7) continue;
    const getCellData = cell =>
      cell?.Data?.['#text'] !== undefined
        ? cell.Data['#text']
        : cell?.Data || '';

    const id = getCellData(cells[0]);
    if (!id) continue;
    const chroma = getCellData(cells[1]);
    const schedio = getCellData(cells[2]);
    const desc = getCellData(cells[5]);
    const title = `${schedio} ${chroma} (Κωδ. ${id})`;

    // Ο Πραξιτέλης είναι by default Κουζίνα / HPL
    masterProducts.push({
      id: `PRAX-${id}`,
      title,
      description: desc,
      category: 'HPL / Πορτάκια',
      image: getCellData(cells[6]),
      supplier: 'Praxitelis',
      material: 'hpl',
      usage: 'kitchen'
    });
  }
}

async function runSync() {
  console.log('🚀 Ξεκινάει η ενοποίηση με Smart Filters (v2)...');
  await parseAlfawoodCSV();
  await parseDecostarXML();
  await parseBensiosXML();
  await parseEleftheriouXML();
  await parsePraxitelisXML();
  await fs.outputJson(OUTPUT_FILE, masterProducts, { spaces: 2 });
  console.log(
    `🎉 Ολοκληρώθηκε! Έτοιμα ${masterProducts.length} προϊόντα στο JSON.`
  );
}

runSync();

const slugify = (value) => String(value)
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const skuPart = (value) => String(value)
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const specs = [
  ['DEMO Essential Crew Tee', 'T-Shirts', ['Black', 'Chalk'], ['XS', 'S', 'M', 'L', 'XL'], 189900, 'dev-dummy-essential-heavyweight-crewneck'],
  ['DEMO Compact Box Tee', 'T-Shirts', ['Soft Mint', 'Warm Stone'], ['XS', 'S', 'M', 'L', 'XL'], 169900, 'dev-dummy-compact-cotton-box-tee'],
  ['DEMO Washed Jersey Tee', 'T-Shirts', ['Dusty Rose', 'Faded Slate'], ['XS', 'S', 'M', 'L', 'XL'], 149900, 'dev-dummy-washed-jersey-tee'],
  ['DEMO Oxford Button-Down', 'Shirts', ['Blue Stripe', 'White'], ['S', 'M', 'L', 'XL', 'XXL'], 249900, 'dev-dummy-oxford-button-down'],
  ['DEMO Linen Resort Shirt', 'Shirts', ['Sand', 'Olive'], ['S', 'M', 'L', 'XL', 'XXL'], 279900, 'dev-dummy-linen-blend-resort-shirt'],
  ['DEMO Micro-Check Shirt', 'Shirts', ['Teal Check', 'Ecru Check'], ['S', 'M', 'L', 'XL', 'XXL'], 229900, 'dev-dummy-micro-check-cotton-shirt'],
  ['DEMO Brushed Fleece Pullover', 'Hoodies', ['Mushroom', 'Cloud'], ['S', 'M', 'L', 'XL', 'XXL'], 329900, 'dev-dummy-brushed-fleece-pullover'],
  ['DEMO Zip-Front Fleece Hoodie', 'Hoodies', ['Espresso', 'Stone'], ['S', 'M', 'L', 'XL', 'XXL'], 349900, 'dev-dummy-zip-front-fleece-hoodie'],
  ['DEMO French-Terry Relaxed Hoodie', 'Hoodies', ['Black', 'Ash Grey'], ['S', 'M', 'L', 'XL', 'XXL'], 319900, 'dev-dummy-french-terry-relaxed-hoodie'],
  ['DEMO Tapered Cotton Chino', 'Trousers', ['Khaki', 'Navy'], ['30', '32', '34', '36', '38'], 299900, 'dev-dummy-tapered-cotton-chino'],
  ['DEMO Relaxed Pleated Trouser', 'Trousers', ['Charcoal', 'Stone'], ['30', '32', '34', '36', '38'], 369900, 'dev-dummy-relaxed-pleated-trouser'],
  ['DEMO Linen Drawstring Trouser', 'Trousers', ['Ink', 'Natural'], ['30', '32', '34', '36', '38'], 289900, 'dev-dummy-linen-blend-drawstring-trouser'],
  ['DEMO Indigo Straight Jean', 'Jeans', ['Dark Indigo', 'Rinse Blue'], ['30', '32', '34', '36', '38'], 349900, 'dev-dummy-indigo-straight-jean'],
  ['DEMO Mid-Wash Tapered Jean', 'Jeans', ['Mid Wash', 'Deep Blue'], ['30', '32', '34', '36', '38'], 329900, 'dev-dummy-mid-wash-tapered-jean'],
  ['DEMO Ecru Relaxed Jean', 'Jeans', ['Ecru', 'Natural White'], ['30', '32', '34', '36', '38'], 359900, 'dev-dummy-ecru-relaxed-jean'],
  ['DEMO Cotton-Twill Utility Jacket', 'Jackets', ['Deep Teal', 'Olive'], ['S', 'M', 'L', 'XL', 'XXL'], 459900, 'dev-dummy-cotton-twill-utility-jacket'],
  ['DEMO Harrington Jacket', 'Jackets', ['Black', 'Moss'], ['S', 'M', 'L', 'XL', 'XXL'], 429900, 'dev-dummy-lightweight-harrington-jacket'],
  ['DEMO Quilted Liner Jacket', 'Jackets', ['Ochre', 'Tobacco'], ['S', 'M', 'L', 'XL', 'XXL'], 479900, 'dev-dummy-quilted-liner-jacket']
];

function buildVariants(productIndex, productName, colours, sizes, unitCostPaise) {
  const variants = [];
  for (let colourIndex = 0; colourIndex < colours.length; colourIndex += 1) {
    const colour = colours[colourIndex];
    for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex += 1) {
      const size = sizes[sizeIndex];
      const position = productIndex * 100 + colourIndex * 10 + sizeIndex;
      let stock = ((position * 7) % 23);
      if (position % 19 === 0) stock = 0;
      if (position % 29 === 0) stock = 3;
      let status = 'active';
      if (position % 31 === 0) status = 'inactive';
      if (position % 37 === 0) status = 'discontinued';
      if (status !== 'active' && stock > 0) stock = 0;

      variants.push({
        size,
        colour,
        sku: `YQ-DEMO-${skuPart(productName).slice(0, 18)}-${skuPart(colour).slice(0, 8)}-${skuPart(size)}`,
        pricePaise: null,
        discountPricePaise: null,
        images: [],
        status,
        stock,
        reorderTarget: stock <= 5 ? 12 : 8,
        reservedQuantity: 0,
        unitCostPaise,
        costedQuantity: stock
      });
    }
  }
  return variants;
}

export function buildDemoCatalogFixture() {
  const products = specs.map(([name, category, colourNames, sizes, pricePaise, imageKey], productIndex) => {
    const slug = `yaqana-demo-${slugify(name).replace(/^demo-/, '')}`;
    const productImage = `/images/dev-products/${imageKey}.jpg`;
    const colours = colourNames.map((colour, colourIndex) => ({
      name: colour,
      hex: ['#171717', '#D9D2C7', '#7A806F', '#7F9BAA', '#A98D66', '#D6C6B1'][colourIndex % 6],
      images: [productImage]
    }));
    const unitCostPaise = Math.round(pricePaise * (58 + (productIndex % 7)) / 100);
    const variants = buildVariants(productIndex, name, colourNames, sizes, unitCostPaise);

    return {
      name,
      slug,
      description: `DEMO DATA — ${name.replace(/^DEMO /, '')} is a fictional YAQANA catalogue item for local and preview demonstration.`,
      shortDescription: 'Fictional demo menswear product.',
      category,
      gender: 'men',
      pricePaise,
      discountPricePaise: productIndex % 4 === 0 ? pricePaise - 30000 : null,
      sizes,
      colours,
      variants,
      stock: variants.reduce((sum, variant) => sum + variant.stock, 0),
      images: [productImage],
      status: 'active',
      active: true,
      featured: productIndex % 5 === 0,
      newArrival: productIndex % 6 === 0,
      bestSeller: productIndex % 7 === 0,
      fabricDetails: 'Fictional demo fabric specification.',
      fitDetails: 'Fictional demo fit specification.',
      careInstructions: 'Fictional demo care instructions.',
      collectionName: `DEMO — ${category}`,
      shippingDetails: 'Demo shipping information.',
      isDemoData: true,
      demoKey: `YAQANA-DEMO-${slugify(name).toUpperCase()}`,
      demoLabel: 'DEMO CATALOGUE'
    };
  });

  const categoryNames = [...new Set(specs.map(([, category]) => category))];
  const categories = categoryNames.map((category) => ({
    name: category,
    slug: slugify(category),
    image: '',
    gender: 'men',
    active: true
  }));
  const collectionNames = [...new Set(products.map((product) => product.collectionName))];
  const collections = collectionNames.map((name) => ({
    name,
    slug: slugify(name),
    description: 'Clearly identified fictional demo catalogue collection.',
    image: '',
    active: true
  }));

  return { categories, collections, products };
}

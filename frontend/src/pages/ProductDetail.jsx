import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Heart, ShoppingBag, Truck, RefreshCw, ShieldCheck, ChevronRight, Check, X } from 'lucide-react';
import { productService } from '../services/api';
import { formatInr } from '../utils/currency';
import { getProductImage, getProductImages, getCategoryImage, PRODUCT_IMAGE_FALLBACK } from '../utils/productImage';
import {
  getVariantAvailability,
  getVariantImages,
  getVariantPrice,
  getVariantStatus
} from '../utils/productVariants';
import {
  getDemoSizesForColour,
  isDemoVariantSelectable
} from '../utils/demoCatalogue';
import { addProductToCartAndCheckout } from '../utils/buyNow.js';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import ProductCard from '../components/ProductCard';
import LoadingSpinner from '../components/LoadingSpinner';

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCart();
  const { toggleWishlist, isInWishlist } = useWishlist();

  const [product, setProduct] = useState(null);
  const [relatedProducts, setRelatedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColour, setSelectedColour] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState('details');
  const [addedNotice, setAddedNotice] = useState(false);
  const [cartError, setCartError] = useState('');
  const [pendingPurchase, setPendingPurchase] = useState(null);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        setLoading(true);
        const res = await productService.getProductById(id);
        if (res.data.success) {
          const prod = res.data.product;
          const firstColour = prod.colours?.[0]?.name || 'Default';
          const firstColourSizes = getDemoSizesForColour(prod, firstColour);
          const firstSize = firstColourSizes.find((size) => isDemoVariantSelectable(prod, firstColour, size))
            || firstColourSizes[0]
            || prod.sizes?.[0]
            || '';
          setProduct(prod);
          setSelectedImage(getProductImage({ ...prod, images: getVariantImages(prod, firstSize, firstColour) }));
          setSelectedSize(firstSize);
          setSelectedColour(firstColour);
          setRelatedProducts(res.data.relatedProducts || []);
        }
      } catch (err) {
        console.error('Failed to load product detail:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  useEffect(() => {
    if (!sizeGuideOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setSizeGuideOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sizeGuideOpen]);

  if (loading) {
    return <LoadingSpinner message="Curating garment specifications..." />;
  }

  if (!product) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <h2 className="font-serif text-3xl text-xora-charcoal mb-4">Product Not Found</h2>
        <p className="text-xs text-xora-taupe-dark mb-6">
          The requested garment might have concluded its seasonal run.
        </p>
        <Link to="/shop" className="btn-luxury">
          RETURN TO SHOP
        </Link>
      </div>
    );
  }

  const isFavorited = isInWishlist(product._id);
  const selectedStock = getVariantAvailability(product, selectedSize, selectedColour);
  const selectedVariantStatus = getVariantStatus(product, selectedSize, selectedColour);
  const selectedPrice = getVariantPrice(product, selectedSize, selectedColour);
  const hasSelectedPriceDiscount = selectedPrice.price < selectedPrice.originalPrice;
  const selectedGalleryProduct = { ...product, images: getVariantImages(product, selectedSize, selectedColour) };
  const selectedImages = getProductImages(selectedGalleryProduct);
  const demoSizesForColour = getDemoSizesForColour(product, selectedColour);
  const selectedVariant = Array.isArray(product.variants)
    ? product.variants.find((variant) =>
      String(variant.size || '').toLowerCase() === String(selectedSize || '').toLowerCase() &&
      String(variant.colour || '').toLowerCase() === String(selectedColour || '').toLowerCase()
    )
    : null;
  const isOutOfStock = selectedVariantStatus !== 'active' || selectedStock <= 0 ||
    (product.isDemoData && !isDemoVariantSelectable(product, selectedColour, selectedSize));
  const isLowStock = selectedStock > 0 && selectedStock <= 5;

  const handleColourSelection = (colour) => {
    const nextSizes = getDemoSizesForColour(product, colour);
    const nextSize = nextSizes.find((size) => isDemoVariantSelectable(product, colour, size))
      || nextSizes[0]
      || '';
    setSelectedColour(colour);
    setSelectedSize(nextSize);
    setQuantity(1);
    setSelectedImage(getProductImage({ ...product, images: getVariantImages(product, nextSize, colour) }));
  };

  const handleAddToCart = async () => {
    if (isOutOfStock || pendingPurchase) return;
    setCartError('');
    setPendingPurchase('cart');
    const result = await addToCart(product, selectedSize, selectedColour, quantity);
    setPendingPurchase(null);
    if (!result?.success) {
      setCartError(result?.message || 'Could not add this item to your bag.');
      return;
    }
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 2000);
  };

  const handleBuyNow = async () => {
    if (isOutOfStock || pendingPurchase) return;
    setCartError('');
    setPendingPurchase('buyNow');
    const result = await addProductToCartAndCheckout({
      addToCart,
      navigate,
      product,
      size: selectedSize,
      colour: selectedColour,
      quantity
    });
    setPendingPurchase(null);
    if (!result?.success) setCartError(result?.message || 'Could not add this item to your cart.');
  };

  return (
    <div className="bg-xora-cream min-h-screen text-xora-charcoal py-8 sm:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center space-x-2 text-[11px] uppercase tracking-luxury text-xora-taupe-dark mb-8">
          <Link to="/" className="hover:text-xora-charcoal">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to="/shop" className="hover:text-xora-charcoal">Shop</Link>
          <ChevronRight className="w-3 h-3" />
          <Link to={`/shop?category=${product.category}`} className="hover:text-xora-charcoal">
            {product.category}
          </Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-xora-charcoal font-medium truncate max-w-[200px]">{product.name}</span>
        </nav>

        {/* Main Product Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          {/* Left Column: Images */}
          <div className="lg:col-span-7 flex flex-col-reverse sm:flex-row gap-4">
            {/* Thumbnail selector */}
            {selectedImages.length > 1 && (
              <div className="flex sm:flex-col gap-3 overflow-x-auto sm:overflow-visible">
                {selectedImages.map((img, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedImage(img)}
                    className={`w-16 h-20 flex-shrink-0 rounded-xs overflow-hidden border-2 transition-all ${
                      selectedImage === img
                      ? 'border-[#6a5543] scale-95'
                        : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-contain bg-xora-sand/30" onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = PRODUCT_IMAGE_FALLBACK; }} />
                  </button>
                ))}
              </div>
            )}

            {/* Large Preview */}
            <div className="flex-1 aspect-[3/4] bg-xora-sand/50 rounded-xs overflow-hidden shadow-xs relative">
              <img
                src={selectedImage || getProductImage(selectedGalleryProduct)}
                alt={product.name}
                className="w-full h-full object-contain object-center bg-xora-sand/30"
                onError={(event) => {
                  const image = event.currentTarget;
                  if (image.dataset.categoryFallback !== 'true') {
                    image.dataset.categoryFallback = 'true';
                    image.src = getCategoryImage(product.category);
                  } else {
                    image.onerror = null;
                    image.src = PRODUCT_IMAGE_FALLBACK;
                  }
                }}
              />
              {hasSelectedPriceDiscount && (
                <span className="absolute top-4 left-4 bg-xora-charcoal text-white text-xs uppercase tracking-widest px-3 py-1 font-medium">
                  Privilege Sale
                </span>
              )}
            </div>
          </div>

          {/* Right Column: Garment Information & Actions */}
          <div className="lg:col-span-5 flex flex-col justify-start space-y-6">
            <div>
              <span className="text-xs uppercase tracking-luxury text-xora-taupe-dark font-medium">
                {product.category} • {product.gender}
              </span>
              <h1 className="font-serif text-2xl sm:text-4xl text-xora-charcoal tracking-wide mt-1 font-light">
                {product.name}
              </h1>

              {/* Pricing */}
              <div className="flex items-baseline space-x-3 mt-3">
                {hasSelectedPriceDiscount ? (
                  <>
                    <span className="text-xl sm:text-2xl font-semibold text-xora-charcoal">
                      {formatInr(selectedPrice.price)}
                    </span>
                    <span className="text-sm text-xora-taupe-dark line-through">
                      {formatInr(selectedPrice.originalPrice)}
                    </span>
                    <span className="text-xs text-emerald-800 font-medium bg-emerald-50 px-2 py-0.5 rounded">
                      Save {formatInr(selectedPrice.originalPrice - selectedPrice.price)}
                    </span>
                  </>
                ) : (
                  <span className="text-xl sm:text-2xl font-semibold text-xora-charcoal">
                    {formatInr(selectedPrice.price)}
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            {product.isDemoData && (
              <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900" role="note">
                <strong>DEMO CATALOGUE</strong> — fictional product, price and stock data.
                {selectedVariant?.sku && <span className="ml-2 font-mono">SKU {selectedVariant.sku}</span>}
              </div>
            )}
            <p className="text-xs sm:text-sm text-xora-taupe-dark leading-relaxed font-light">
              {product.description}
            </p>

            {/* Colour Selector */}
            {product.colours && product.colours.length > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="font-medium uppercase tracking-wider text-xora-charcoal">
                    Colour: <strong className="font-semibold">{selectedColour}</strong>
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  {product.colours.map((col, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleColourSelection(col.name)}
                      className={`group relative p-1 rounded-full border-2 transition-all ${
                        selectedColour === col.name ? 'border-[#6a5543]' : 'border-transparent'
                      }`}
                      title={col.name}
                    >
                      <span
                        className="block w-6 h-6 rounded-full border border-black/10 shadow-xs"
                        style={{ backgroundColor: col.hex || '#C4B5A5' }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Size Selector */}
            {product.sizes && product.sizes.length > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-2">
                  <span className="font-medium uppercase tracking-wider text-xora-charcoal">
                    Size: <strong className="font-semibold">{selectedSize}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSizeGuideOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={sizeGuideOpen}
                    className="text-xora-taupe-dark underline hover:text-xora-charcoal"
                  >
                    Sizing Guide
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {demoSizesForColour.map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      disabled={product.isDemoData && !isDemoVariantSelectable(product, selectedColour, sz)}
                      onClick={() => {
                        setSelectedSize(sz);
                        setQuantity(1);
                        setSelectedImage(getProductImage({ ...product, images: getVariantImages(product, sz, selectedColour) }));
                      }}
                      className={`py-3 text-xs font-medium uppercase tracking-wider border rounded-xs transition-all ${
                        selectedSize === sz
                          ? 'border-[#6a5543] bg-[#6a5543] text-white shadow-xs'
                          : 'border-xora-taupe/40 bg-white text-xora-charcoal hover:border-[#6a5543]'
                      } disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:border-neutral-200`}
                      title={
                        product.isDemoData && !isDemoVariantSelectable(product, selectedColour, sz)
                          ? 'This demo variant is unavailable'
                          : `${sz}`
                      }
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Stock status indicator */}
            <div className="text-xs">
              {selectedVariantStatus !== 'active' ? (
                <span className="text-red-700 font-medium">This variant is currently unavailable</span>
              ) : isOutOfStock ? (
                <span className="text-red-700 font-medium">Currently Sold Out</span>
              ) : isLowStock ? (
                <span className="text-amber-800 font-medium">Only {selectedStock} items remaining in atelier</span>
              ) : (
                <span className="text-emerald-800 font-medium">In Stock • Ready for dispatch</span>
              )}
            </div>

            {/* Purchase actions */}
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                {/* Quantity */}
                <div className="col-span-1 flex w-fit flex-shrink-0 items-center border border-xora-taupe/40 bg-white px-3">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1 || isOutOfStock}
                    className="p-1 text-xora-charcoal hover:text-black disabled:opacity-40"
                  >
                    -
                  </button>
                  <span className="text-xs font-semibold px-4 min-w-[32px] text-center">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(selectedStock, q + 1))}
                    disabled={quantity >= selectedStock || isOutOfStock}
                    className="p-1 text-xora-charcoal hover:text-black disabled:opacity-40"
                  >
                    +
                  </button>
                </div>

                {/* Wishlist Button */}
                <button
                  type="button"
                  onClick={() => toggleWishlist(product)}
                  className={`col-start-2 row-start-1 justify-self-end p-3.5 border rounded-xs transition-colors flex items-center justify-center ${
                    isFavorited
                      ? 'border-xora-charcoal bg-xora-charcoal text-white'
                      : 'border-xora-taupe/40 bg-white text-xora-charcoal hover:border-xora-charcoal'
                  }`}
                  aria-label={isFavorited ? 'Remove from wishlist' : 'Add to wishlist'}
                  id="product-wishlist-detail-btn"
                >
                  <Heart className={`w-5 h-5 ${isFavorited ? 'fill-current' : 'stroke-[1.5]'}`} />
                </button>

                {/* Add to Cart Button */}
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={isOutOfStock || Boolean(pendingPurchase)}
                  className="col-span-2 w-full min-w-0 product-purchase-button product-purchase-button--primary disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
                  id="add-to-cart-detail-btn"
                >
                  {addedNotice ? (
                    <span className="flex items-center justify-center space-x-2">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>ADDED TO CART</span>
                    </span>
                  ) : pendingPurchase === 'cart' ? (
                    'ADDING…'
                  ) : isOutOfStock ? (
                    'OUT OF STOCK'
                  ) : (
                    <span className="flex items-center justify-center space-x-2">
                      <ShoppingBag className="w-4 h-4" />
                      <span>ADD TO CART</span>
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleBuyNow}
                  disabled={isOutOfStock || Boolean(pendingPurchase)}
                  className="col-span-2 w-full min-w-0 product-purchase-button product-purchase-button--secondary disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
                  id="buy-now-detail-btn"
                >
                  {pendingPurchase === 'buyNow' ? 'PROCESSING…' : isOutOfStock ? 'OUT OF STOCK' : 'BUY NOW'}
                </button>
              </div>
              {cartError && <p role="alert" className="text-xs text-red-700">{cartError}</p>}
            </div>

            {/* Accordion / Tabs */}
            <div className="border-t border-xora-taupe/20 pt-6 space-y-4">
              <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-xora-taupe/20 text-xs uppercase tracking-luxury">
                <button
                  type="button"
                  onClick={() => setActiveTab('details')}
                  className={`pb-2.5 font-medium transition-colors ${
                    activeTab === 'details'
                      ? 'border-b-2 border-xora-charcoal text-xora-charcoal font-semibold'
                      : 'text-xora-taupe-dark hover:text-xora-charcoal'
                  }`}
                >
                  Craft & Composition
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('fit')}
                  className={`pb-2.5 font-medium transition-colors ${
                    activeTab === 'fit'
                      ? 'border-b-2 border-xora-charcoal text-xora-charcoal font-semibold'
                      : 'text-xora-taupe-dark hover:text-xora-charcoal'
                  }`}
                >
                  Sizing & Fit
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('shipping')}
                  className={`pb-2.5 font-medium transition-colors ${
                    activeTab === 'shipping'
                      ? 'border-b-2 border-xora-charcoal text-xora-charcoal font-semibold'
                      : 'text-xora-taupe-dark hover:text-xora-charcoal'
                  }`}
                >
                  Delivery & Returns
                </button>
              </div>

              <div className="text-xs text-xora-taupe-dark leading-relaxed font-light pt-2">
                {activeTab === 'details' && (
                  <div className="space-y-2">{product.fabricDetails && <p><strong>Materials:</strong> {product.fabricDetails}</p>}{product.careInstructions && <p><strong>Care:</strong> {product.careInstructions}</p>}{!product.fabricDetails && !product.careInstructions && <p>Material and care information has not been provided for this item.</p>}</div>
                )}
                {activeTab === 'fit' && (
                  <p>{product.fitDetails || 'Fit information has not been provided for this item.'}</p>
                )}
                {activeTab === 'shipping' && (
                  <p>Delivery terms are awaiting client confirmation. See the <Link to="/policies" className="underline underline-offset-2">Store Policies draft</Link> for the current returns and exchanges wording.</p>
                )}
              </div>
            </div>

            {/* Assurances */}
            <div className="grid grid-cols-3 gap-2 pt-4 border-t border-xora-taupe/20 text-[11px] text-xora-taupe-dark">
              <div className="flex items-center space-x-1.5">
                <Truck className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Express Dispatch</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
                <Link to="/policies" className="underline underline-offset-2">14-Day Policy</Link>
              </div>
              <div className="flex items-center space-x-1.5">
                <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Authentic Atelier</span>
              </div>
            </div>
          </div>
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <section className="mt-24 pt-12 border-t border-xora-taupe/20">
            <div className="text-center mb-10">
              <span className="text-[11px] uppercase tracking-luxury text-xora-taupe-dark font-medium">
                Harmonious Pairings
              </span>
              <h2 className="font-serif text-2xl sm:text-3xl text-xora-charcoal tracking-wide mt-1">
                Complete The Silhouette
              </h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
              {relatedProducts.map((rel) => (
                <ProductCard key={rel._id} product={rel} />
              ))}
            </div>
          </section>
        )}
      </div>

      {sizeGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close sizing guide"
            className="absolute inset-0 bg-black/50"
            onClick={() => setSizeGuideOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="size-guide-title"
            className="relative w-full max-w-md max-h-[90vh] overflow-y-auto bg-xora-offwhite border border-xora-taupe/30 p-6 sm:p-8 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-luxury text-xora-taupe-dark">Fit & sizing</span>
                <h2 id="size-guide-title" className="font-serif text-2xl text-xora-charcoal mt-1">{product.name}</h2>
              </div>
              <button
                type="button"
                aria-label="Close sizing guide"
                onClick={() => setSizeGuideOpen(false)}
                className="p-1 text-xora-charcoal hover:text-xora-taupe-dark"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="mt-5 text-xs text-xora-taupe-dark">Available sizes</p>
            <p className="mt-1 text-sm font-medium text-xora-charcoal">{product.sizes?.join(' · ')}</p>
            <p className="mt-4 text-sm leading-relaxed text-xora-taupe-dark">
              {product.fitDetails || 'Fit details have not been provided for this item.'}
            </p>
            {product.measurements && Object.keys(product.measurements).length > 0 && <div className="mt-5 overflow-x-auto"><h3 className="text-xs font-semibold">Garment measurements</h3><table className="mt-2 w-full text-left text-xs"><thead><tr><th className="py-2">Size</th>{Object.keys(product.measurements[product.sizes?.[0]] || {}).map((label) => <th key={label} className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{product.sizes?.map((size) => <tr key={size} className="border-t border-xora-taupe/20"><th className="py-2">{size}</th>{Object.values(product.measurements[size] || {}).map((value, index) => <td key={index} className="px-2 py-2">{value} cm</td>)}</tr>)}</tbody></table><p className="mt-2 text-[11px]">Sample measurements are in centimetres and await client confirmation. Compare with a similar garment laid flat. Chest, waist, and hip are garment circumferences; sleeve runs shoulder seam to cuff, body length shoulder point to hem, and trouser inseam crotch seam to hem.</p></div>}
            <Link
              to="/contact"
              onClick={() => setSizeGuideOpen(false)}
              className="inline-flex mt-5 text-xs uppercase tracking-luxury text-xora-charcoal underline underline-offset-4"
            >
              Ask our concierge
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { cartService } from '../services/api';
import { useAuth } from './AuthContext';
import { getProductImage } from '../utils/productImage';
import {
  getVariantAvailability,
  getVariantImages,
  getVariantPrice,
  getVariantStatus
} from '../utils/productVariants';
import { getCartQuantityError } from '../utils/cartStock';

const CartContext = createContext();

const formatCartItems = (items = []) => items
  .filter((item) => item.product)
  .map((item) => {
    const price = getVariantPrice(item.product, item.size, item.colour);
    return {
      _id: item._id,
      productId: item.product._id,
      name: item.product.name,
      price: price.price,
      originalPrice: price.originalPrice,
      image: getProductImage({ ...item.product, images: getVariantImages(item.product, item.size, item.colour) }),
      category: item.product.category,
      size: item.size,
      colour: item.colour,
      quantity: item.quantity,
      stock: getVariantAvailability(item.product, item.size, item.colour),
      status: getVariantStatus(item.product, item.size, item.colour)
    };
  });

export const CartProvider = ({ children }) => {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [items, setItems] = useState(() => {
    try {
      const saved = localStorage.getItem('xora_local_cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const itemsRef = useRef(items);
  const setCartItems = (update) => {
    const nextItems = typeof update === 'function' ? update(itemsRef.current) : update;
    itemsRef.current = nextItems;
    setItems(nextItems);
  };
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cartOwner, setCartOwner] = useState(null);

  // When user logs in, fetch backend cart and sync
  useEffect(() => {
    if (authLoading) return;

    if (isAuthenticated) {
      loadBackendCart();
    } else {
      setCartItems((currentItems) => currentItems.filter((item) => String(item._id).startsWith('temp-')));
      setCartOwner('guest');
    }
  }, [isAuthenticated, authLoading, user?._id]);

  const cartLoading = loading || authLoading || (
    isAuthenticated ? cartOwner !== String(user?._id) : cartOwner !== 'guest'
  );

  // Persist guest cart locally
  useEffect(() => {
    try {
      localStorage.setItem('xora_local_cart', JSON.stringify(items));
    } catch (e) {
      console.error('Failed to save cart to localStorage', e);
    }
  }, [items]);

  const loadBackendCart = async () => {
    try {
      setLoading(true);
      const guestItems = items.filter((item) => String(item._id).startsWith('temp-'));
      if (guestItems.length > 0) {
        const syncRes = await cartService.syncCart({
          items: guestItems.map(({ productId, size, colour, quantity }) => ({
            productId,
            size,
            colour,
            quantity
          }))
        });
        if (syncRes.data.success && syncRes.data.cart?.items) {
          setCartItems(formatCartItems(syncRes.data.cart.items));
          return;
        }
      }

      const res = await cartService.getCart();
      if (res.data.success && res.data.cart?.items) {
          setCartItems(formatCartItems(res.data.cart.items));
      }
    } catch (err) {
      console.warn('Failed to fetch user cart from backend:', err);
    } finally {
      setLoading(false);
      setCartOwner(String(user?._id));
    }
  };

  const addToCart = async (product, size, colour, quantity = 1, { openCart = true } = {}) => {
    const selectedSize = size || (product.sizes && product.sizes[0]) || 'N/A';
    const selectedColour =
      colour || (product.colours && product.colours[0]?.name) || 'Default';
    const selectedStock = getVariantAvailability(product, selectedSize, selectedColour);
    const selectedStatus = getVariantStatus(product, selectedSize, selectedColour);
    const existingQuantity = itemsRef.current
      .filter((item) => String(item.productId) === String(product._id) && item.size === selectedSize && item.colour === selectedColour)
      .reduce((total, item) => total + item.quantity, 0);
    const quantityError = getCartQuantityError({
      currentQuantity: existingQuantity,
      addQuantity: quantity,
      availableStock: selectedStock,
      status: selectedStatus
    });
    if (quantityError) {
      return {
        success: false,
        message: quantityError === 'STOCK_CHANGED'
          ? 'The available stock is lower than your requested quantity. Update your bag and try again.'
          : 'This size and colour combination is no longer available.'
      };
    }
    const selectedPrice = getVariantPrice(product, selectedSize, selectedColour);
    const image = getProductImage({ ...product, images: getVariantImages(product, selectedSize, selectedColour) });

    const addLocalItem = () => setCartItems((prev) => {
      const existingIdx = prev.findIndex(
        (item) =>
          String(item.productId) === String(product._id) &&
          item.size === selectedSize &&
          item.colour === selectedColour
      );

      if (existingIdx > -1) {
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: next[existingIdx].quantity + quantity
        };
        return next;
      } else {
        return [
          ...prev,
          {
            _id: `temp-${Date.now()}-${Math.random()}`,
            productId: product._id,
            name: product.name,
            price: selectedPrice.price,
            originalPrice: selectedPrice.originalPrice,
            image,
            category: product.category,
            size: selectedSize,
            colour: selectedColour,
            quantity,
            stock: selectedStock,
            status: selectedStatus
          }
        ];
      }
    });

    // If authenticated, only report success after the backend accepts the item.
    if (isAuthenticated) {
      try {
        const res = await cartService.addToCart({
          productId: product._id,
          size: selectedSize,
          colour: selectedColour,
          quantity
        });
        if (res.data.success && res.data.cart?.items) {
        setCartItems(formatCartItems(res.data.cart.items));
        } else {
          return { success: false, message: res.data.message || 'Could not add this item to your bag.' };
        }
      } catch (err) {
        return { success: false, message: err.response?.data?.message || 'Could not add this item to your bag. Please try again.' };
      }
    } else {
      addLocalItem();
    }

    if (openCart) setIsCartOpen(true);
    return { success: true };
  };

  const updateQuantity = async (itemId, quantity) => {
    if (quantity <= 0) {
      removeFromCart(itemId);
      return;
    }

    if (isAuthenticated && !itemId.toString().startsWith('temp-')) {
      try {
        const res = await cartService.updateQuantity({ itemId, quantity });
        if (res.data.success && res.data.cart?.items) {
          setCartItems(formatCartItems(res.data.cart.items));
        } else {
          await loadBackendCart();
          return {
            success: false,
            message: res.data.message || 'Could not update this item in your bag.'
          };
        }
      } catch (err) {
        const message = err.response?.data?.message || 'Could not update this item in your bag. Check your connection and try again.';
        try {
          await loadBackendCart();
        } catch {
          // Keep the actionable update failure for the caller even if refresh also fails.
        }
        return { success: false, message };
      }
      return;
    }

    const item = itemsRef.current.find((entry) => entry._id === itemId);
    if (!item) return { success: false, message: 'This item is no longer in your bag.' };
    const quantityError = getCartQuantityError({
      desiredQuantity: quantity,
      availableStock: item.stock,
      status: item.status
    });
    if (quantityError) return { success: false, message: 'The available stock changed. Reduce the quantity or refresh your bag.' };
    setCartItems((prev) => prev.map((entry) => (entry._id === itemId ? { ...entry, quantity } : entry)));
    return { success: true };
  };

  const removeFromCart = async (itemId) => {
    if (isAuthenticated && !itemId.toString().startsWith('temp-')) {
      try {
        const res = await cartService.removeFromCart(itemId);
        if (res.data.success && res.data.cart?.items) {
          setCartItems(formatCartItems(res.data.cart.items));
        }
      } catch (err) {
        console.warn('Failed to remove item on backend', err);
        await loadBackendCart();
      }
      return;
    }

    setCartItems((prev) => prev.filter((item) => item._id !== itemId));
  };

  const clearCart = () => {
    setCartItems([]);
    localStorage.removeItem('xora_local_cart');
  };

  const totalCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const shippingFee = subtotal >= 200 || subtotal === 0 ? 0 : 15;
  const estimatedTax = Math.round(subtotal * 0.08 * 100) / 100;
  const grandTotal = subtotal + shippingFee + estimatedTax;

  return (
    <CartContext.Provider
      value={{
        items,
        isCartOpen,
        openCart: () => setIsCartOpen(true),
        closeCart: () => setIsCartOpen(false),
        toggleCart: () => setIsCartOpen((prev) => !prev),
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        loading: cartLoading,
        totalCount,
        subtotal,
        shippingFee,
        estimatedTax,
        grandTotal
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};

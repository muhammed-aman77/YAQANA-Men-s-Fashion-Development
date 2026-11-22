export async function addProductToCartAndCheckout({ addToCart, navigate, product, size, colour, quantity }) {
  const result = await addToCart(product, size, colour, quantity, { openCart: false });
  if (result?.success) navigate('/checkout');
  return result;
}

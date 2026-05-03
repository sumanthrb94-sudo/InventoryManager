export function getWarrantyStatus(saleDate?: string | null) {
  if (!saleDate) return { isExpired: false, daysLeft: 0, hasWarranty: false, endDate: null };

  const soldDate = new Date(saleDate);
  const now = new Date();
  const warrantyEndDate = new Date(soldDate);
  warrantyEndDate.setFullYear(warrantyEndDate.getFullYear() + 1);

  const msLeft = warrantyEndDate.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  return {
    hasWarranty: true,
    isExpired: daysLeft < 0,
    daysLeft,
    endDate: warrantyEndDate.toISOString().split('T')[0]
  };
}

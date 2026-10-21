/** Two-digit page numbers ("01", "12"), as the portfolio numbers its sections. */
export const pageNumber = (index: number) => String(index + 1).padStart(2, '0')

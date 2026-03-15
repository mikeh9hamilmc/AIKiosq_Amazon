/**
 * Inventory Service
 *
 * Handles inventory lookups for plumbing parts
 */

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  aisle: string;
  stock: number;
  price: number;
  description: string;
}

interface InventoryData {
  items: InventoryItem[];
}

export class InventoryService {
  private inventory: InventoryData | null = null;

  async loadInventory(): Promise<void> {
    try {
      const response = await fetch('/inventory.json');
      this.inventory = await response.json();
    } catch (error) {
      console.error('Failed to load inventory:', error);
      this.inventory = { items: [] };
    }
  }

  /**
   * Search for items by keywords
   */
  searchItems(query: string): InventoryItem[] {
    if (!this.inventory) return [];

    const queryLower = query.toLowerCase();
    const terms = queryLower.split(' ').filter(t => t.length > 2);

    return this.inventory.items.filter(item => {
      const searchText = [
        item.name,
        item.description,
        item.category,
        ...item.keywords
      ].join(' ').toLowerCase();

      return terms.some(term => searchText.includes(term));
    });
  }

  /**
   * Get complementary items (things often bought together)
   */
  getComplementaryItems(itemId: string): InventoryItem[] {
    if (!this.inventory) return [];

    const item = this.inventory.items.find(i => i.id === itemId);
    if (!item) return [];

    // Simple logic: if it's a switch or outlet, suggest wall plates and wire nuts
    if (item.category === 'switches' || item.category === 'outlets') {
      return this.inventory.items.filter(i =>
        i.id === 'plate-001' || i.id === 'wire-nut-001' || i.id === 'box-001'
      );
    }

    // If it's wire, suggest wire strippers and wire nuts
    if (item.category === 'wire') {
      return this.inventory.items.filter(i =>
        i.id === 'tool-001' || i.id === 'wire-nut-001'
      );
    }

    return [];
  }

  /**
   * Format item for display
   */
  formatItemInfo(item: InventoryItem): string {
    const stockStatus = item.stock > 0
      ? `${item.stock} in stock`
      : 'Out of stock';

    return `${item.name} - ${item.aisle}\n` +
           `Price: $${item.price.toFixed(2)} | ${stockStatus}`;
  }
}

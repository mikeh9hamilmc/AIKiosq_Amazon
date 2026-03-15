import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryService } from '../inventoryService';
import fs from 'fs';
import path from 'path';

// Read real inventory.json
const inventoryPath = path.resolve(__dirname, '../../public/inventory.json');
const realInventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf-8'));

describe('InventoryService', () => {
    let service: InventoryService;

    beforeEach(() => {
        service = new InventoryService();
        // Mock fetch to return the real inventory
        global.fetch = vi.fn().mockResolvedValue({
            json: () => Promise.resolve(realInventory),
        });
    });

    it('loads inventory correctly', async () => {
        await service.loadInventory();
        const results = service.searchItems('switch');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toContain('switch');
    });

    it('handles load errors gracefully', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
        await service.loadInventory();
        const results = service.searchItems('switch');
        expect(results).toHaveLength(0);
    });

    it('searches items by name/keyword', async () => {
        await service.loadInventory();

        // Search by name
        let results = service.searchItems('single pole');
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('switch-001');

        // Search by keyword
        results = service.searchItems('romex');
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe('romex-001');
    });

    it('filters by multiple terms', async () => {
        await service.loadInventory();
        const results = service.searchItems('light switch');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toContain('switch');
    });

    it('returns empty array if not loaded', () => {
        // New service without loadInventory called
        const newService = new InventoryService();
        const results = newService.searchItems('switch');
        expect(results).toHaveLength(0);
    });

    it('suggests complementary items for switches', async () => {
        await service.loadInventory();
        const complements = service.getComplementaryItems('switch-001');
        expect(complements.some(i => i.id === 'plate-001')).toBe(true);
        expect(complements.some(i => i.id === 'wire-nut-001')).toBe(true);
    });

    it('suggests complementary items for wire', async () => {
        await service.loadInventory();
        const complements = service.getComplementaryItems('romex-001');
        expect(complements.some(i => i.id === 'wire-nut-001')).toBe(true);
        expect(complements.some(i => i.id === 'tool-001')).toBe(true);
    });

    it('formats item info correctly', async () => {
        await service.loadInventory();
        const item = realInventory.items.find((i: any) => i.id === 'switch-001');
        const text = service.formatItemInfo(item);
        expect(text).toContain('Single Pole Light Switch');
        expect(text).toContain('$2.99');
        expect(text).toContain('45 in stock');
    });
});


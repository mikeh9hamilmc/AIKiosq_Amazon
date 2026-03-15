import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ElectricalWiringTeacher from '../ElectricalWiringTeacher';
import { LessonStage } from '../../types';

describe('ElectricalWiringTeacher', () => {
    it('renders idle state correctly', () => {
        render(<ElectricalWiringTeacher lessonStage={LessonStage.IDLE} />);
        expect(screen.getByText(/WAITING FOR NEW CUSTOMER/i)).toBeInTheDocument();
    });

    it('renders comparison diagram', () => {
        render(<ElectricalWiringTeacher lessonStage={LessonStage.COMPARE_THREADS} />);
        expect(screen.getByText(/SOLID WIRE/i)).toBeInTheDocument();
        expect(screen.getByText(/STRANDED WIRE/i)).toBeInTheDocument();
    });

    it('renders highlight ferrule state', () => {
        render(<ElectricalWiringTeacher lessonStage={LessonStage.HIGHLIGHT_FERRULE} />);
        expect(screen.getByText(/STRIP LENGTH/i)).toBeInTheDocument();
    });

    it('renders analyzing part spinner', () => {
        render(<ElectricalWiringTeacher lessonStage={LessonStage.ANALYZING_PART} />);
        expect(screen.getByText(/AI ANALYSIS/i)).toBeInTheDocument();
        expect(screen.getByText(/Sparky is examining your part/i)).toBeInTheDocument();
    });

    it('renders snapshot countdown', () => {
        render(<ElectricalWiringTeacher lessonStage={LessonStage.COUNTDOWN_TO_SNAPSHOT} countdownValue={3} />);
        expect(screen.getByText(/HOLD UP YOUR PART/i)).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('renders analysis results', () => {
        const mockAnalysis = {
            partName: 'Burnt Outlet',
            instructions: 'Replace with care.',
            snapshotBase64: 'fakebase64'
        };
        render(
            <ElectricalWiringTeacher
                lessonStage={LessonStage.SHOWING_ANALYSIS}
                partAnalysis={mockAnalysis}
            />
        );
        expect(screen.getByText(/PART IDENTIFIED/i)).toBeInTheDocument();
        expect(screen.getByText(/Burnt Outlet/i)).toBeInTheDocument();
    });

    it('renders inventory results', () => {
        const mockInventory = [{
            id: '1',
            name: 'Test Item',
            category: 'test',
            aisle: 'Aisle 1',
            stock: 5,
            price: 10.99,
            description: 'A test item',
            keywords: []
        }];

        render(
            <ElectricalWiringTeacher
                lessonStage={LessonStage.SHOWING_INVENTORY}
                inventoryItems={mockInventory}
            />
        );
        expect(screen.getByText('Test Item')).toBeInTheDocument();
        expect(screen.getByText('$10.99')).toBeInTheDocument();
        expect(screen.getByText(/5 in stock/i)).toBeInTheDocument();
    });

    it('renders aisle sign', () => {
        render(
            <ElectricalWiringTeacher
                lessonStage={LessonStage.SHOWING_AISLE}
                aisleSignPath="/test-sign.jpg"
            />
        );
        expect(screen.getByText(/FIND IT HERE/i)).toBeInTheDocument();
        const img = screen.getByRole('img', { name: /aisle sign/i });
        expect(img).toHaveAttribute('src', '/test-sign.jpg');
    });
});

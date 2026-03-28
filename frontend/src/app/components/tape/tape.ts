import { Component, computed, input, output } from '@angular/core';
import { Tape } from '@internal/types';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';

@Component({
    selector: 'app-tape',
    templateUrl: 'tape.html',
    styleUrl: 'tape.scss',
    imports: [
        MatTooltip,
        MatIcon,
        MatIconButton,
    ]
})
export class TapeComponent {
    public readonly tape = input.required<Tape>();
    public readonly selected = input<boolean>(false);
    public readonly favorited = input<boolean>(false);
    public readonly toggleFavorite = output<void>();

    public readonly label = computed(() => {
        const tape = this.tape();
        const parts: string[] = [];
        if (tape.event?.trim()) parts.push(tape.event.trim());
        if (tape.title?.trim() && tape.title.trim() !== tape.event?.trim())
            parts.push(tape.title.trim());
        if (parts.length === 0)
            parts.push(tape.text?.trim() || tape._text?.trim() || 'Untitled');
        return parts.join(' — ');
    });

    public readonly date = computed(() => {
        const date = this.tape().date;

        if (!date) return '';

        try {
            const [year, month] = date.split('-');
            const months = [
                'Jan',
                'Feb',
                'Mar',
                'Apr',
                'May',
                'Jun',
                'Jul',
                'Aug',
                'Sep',
                'Oct',
                'Nov',
                'Dec'
            ];
            return `${months[parseInt(month, 10) - 1]} ${year}`;
        } catch {
            return date;
        }
    });

    public readonly location = computed(() => {
        return this.tape().location;
    });
}

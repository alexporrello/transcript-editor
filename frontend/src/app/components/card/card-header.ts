import { Component } from '@angular/core';

@Component({
    selector: 'app-card-header',
    standalone: true,
    template: '<ng-content></ng-content>',
    styleUrl: './card-header.scss',
})
export class CardHeaderComponent {}

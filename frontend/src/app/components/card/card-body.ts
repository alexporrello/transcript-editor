import { Component } from '@angular/core';

@Component({
    selector: 'app-card-body',
    standalone: true,
    template: '<ng-content></ng-content>',
    styleUrl: './card-body.scss',
})
export class CardBodyComponent {}

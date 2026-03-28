import { Component } from '@angular/core';

@Component({
    selector: 'app-card-footer',
    standalone: true,
    template: '<ng-content></ng-content>',
    styleUrl: './card-footer.scss',
})
export class CardFooterComponent {}

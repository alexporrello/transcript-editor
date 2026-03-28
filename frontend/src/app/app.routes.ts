import { Routes } from '@angular/router';
import { ShellComponent } from './components/shell/shell';

export const routes: Routes = [
    { path: 'speakers/:speakerId/search', component: ShellComponent },
    { path: 'speakers/:speakerId', component: ShellComponent },
    { path: '', component: ShellComponent },
    { path: '**', redirectTo: '' },
];

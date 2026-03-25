import { ApplicationConfig, inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter }           from '@angular/router';
import { provideHttpClient }       from '@angular/common/http';
import { routes }                  from './app.routes';
import { UserSessionService }      from './services/user-session-service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideHttpClient(),
    provideAppInitializer(() => {
        const userSessionService = inject(UserSessionService);
        return userSessionService.initialize();
    })
  ]
};
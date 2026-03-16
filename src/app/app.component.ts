import { Component, OnInit, ViewChild } from '@angular/core';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

interface NavItem {
  label: string;
  icon: string;
  route: string;
  action?: boolean;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  imports: [
    CommonModule,
    RouterModule,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatSlideToggleModule,
  ]
})
export class AppComponent implements OnInit {
  @ViewChild('sidenav') sidenav!: MatSidenav;

  title = 'Star Rupture Planner';
  isDarkMode = false;
  isMobile = false;
  sidenavMode: 'over' | 'side' = 'side';
  sidenavOpened = true;
  activeRoute = '';

  navItems: NavItem[] = [    
    { label: 'Factory Layout',      icon: 'factory',        route: '/factory' },
    { label: 'Production Schedule', icon: 'calendar_month', route: '/schedule' },
    { label: 'Upload Data',         icon: 'upload_file',    route: '/upload',   action: true },
  ];

  constructor(
    private breakpointObserver: BreakpointObserver,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Responsive sidenav behaviour
    this.breakpointObserver.observe([Breakpoints.Handset])
      .subscribe(result => {
        this.isMobile = result.matches;
        this.sidenavMode = result.matches ? 'over' : 'side';
        this.sidenavOpened = !result.matches;
      });

    // Track active route for nav highlighting
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        this.activeRoute = e.urlAfterRedirects;
        // Auto-close sidenav on mobile after navigation
        if (this.isMobile) {
          this.sidenav.close();
        }
      });

    // Restore dark mode preference
    const saved = localStorage.getItem('darkMode');
    if (saved === 'true') {
      this.enableDarkMode(true);
    }
  }

  toggleSidenav(): void {
    this.sidenav.toggle();
  }

  toggleDarkMode(): void {
    this.enableDarkMode(!this.isDarkMode);
  }

  private enableDarkMode(enable: boolean): void {
    this.isDarkMode = enable;
    document.body.classList.toggle('dark-theme', enable);
    localStorage.setItem('darkMode', String(enable));
  }

  isActive(route: string): boolean {
    return this.activeRoute === route;
  }
}
import { Component, computed, OnInit, Signal, ViewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
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
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UserSessionService } from './services/user-session-service';
import { ObjectStoreService } from './services/object-store-service';
import { toObservable } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { EnterNameDialog } from './components/enter-name-dialog/enter-name-dialog';
import { ItemSelectDialog } from './components/item-select-dialog/item-select-dialog';
import * as _ from 'lodash';

interface NavItem {
  label: string;
  icon: string;
  route: string;
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
    MatBadgeModule,
    MatDialogModule,
    MatTooltipModule,
  ]
})
export class AppComponent implements OnInit {
  @ViewChild('sidenav') sidenav!: MatSidenav;

  readonly repoUrl = 'https://github.com/straziota18/reassert';

  readonly title: Signal<string>;
  isDarkMode = false;
  isMobile = false;
  sidenavMode: 'over' | 'side' = 'side';
  sidenavOpened = true;
  activeRoute = '';

  readonly nbProblems = computed(() => {
    return _.size(this.userSessionService.factoryProblems());
  });

  navItems: NavItem[] = [
    { label: 'Factory Layout', icon: 'factory', route: '/factory-layout' },
    { label: 'Factory Inventory', icon: 'edit_document', route: '/factory-inventory' },
    { label: 'Production Schedule', icon: 'calendar_month', route: '/schedule' },
    { label: 'Help', icon: 'help', route: '/welcome' },
  ];

  constructor(
    private readonly breakpointObserver: BreakpointObserver,
    private readonly router: Router,
    private readonly titleService: Title,
    private readonly userSessionService: UserSessionService,
    private readonly objectStoreService: ObjectStoreService,
    private readonly dialog: MatDialog,
  ) {
    this.title = computed(() => {
      const l = this.userSessionService.activeLayout();
      return `Star Rupture Planner - ${l ? l.id : 'Global layout'}`;
    });
    toObservable(this.userSessionService.activeLayout).subscribe(l => {
      this.titleService.setTitle(`Reassert - ${l ? l.id : 'Global layout'}`);
    });
  }

  ngOnInit(): void {
    // Responsive sidenav behaviour
    this.breakpointObserver.observe([Breakpoints.Handset])
      .subscribe(result => {
        this.isMobile = result.matches;
        this.sidenavMode = result.matches ? 'over' : 'side';
        this.sidenavOpened = !result.matches;
      });

    // Track active route for nav highlighting and update document title
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        this.activeRoute = e.urlAfterRedirects;
        const activeNav = this.navItems.find(item => item.route === this.activeRoute);
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

  openSaveAsDialog(): void {
    const current = this.userSessionService.activeLayout();
    const ref = this.dialog.open(EnterNameDialog, {
      data: {
        title: 'Save as',
        placeholder: 'New layout name',
        initialValue: current ? current.id : '',
      },
    });
    ref.afterClosed().subscribe(name => {
      if (name) {
        this.userSessionService.saveLayoutAs(name);
      }
    });
  }

  openNewLayoutDialog(): void {
    const ref = this.dialog.open(EnterNameDialog, {
      data: {
        title: 'New layout',
        placeholder: 'Layout name',
      },
    });
    ref.afterClosed().subscribe(name => {
      if (name) {
        this.userSessionService.createNewLayout(name);
      }
    });
  }

  openLayoutDialog(): void {
    const ids = this.objectStoreService.listLayoutIds();
    const ref = this.dialog.open(ItemSelectDialog, {
      data: {
        title: 'Open layout',
        items: ids,
      },
      width: '420px',
      height: '65vh',
      maxWidth: '95vw',
      maxHeight: '90vh',
    });
    ref.afterClosed().subscribe(result => {
      if (result?.label) {
        this.userSessionService.switchToLayout(result.label);
      }
    });
  }
}
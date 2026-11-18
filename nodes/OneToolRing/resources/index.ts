import type { ResourceModule } from '../types';
import { run } from './run';
import { tool } from './tool';

/** Order here is the order in the Resource dropdown (alphabetical by name). */
export const resources: ResourceModule[] = [run, tool];

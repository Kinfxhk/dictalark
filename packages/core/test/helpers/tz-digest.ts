// SPDX-License-Identifier: AGPL-3.0-or-later
import { digest } from './tz-digest-lib';
process.stdout.write(digest() + '\n');

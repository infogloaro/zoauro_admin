import { createInterface } from 'node:readline/promises';
import { DemoSeedError, type Prompter } from '../prisma/demo-seed-run';

// The real terminal for demo:seed / demo:assign. Hidden input reads raw keystrokes and echoes nothing (not even
// asterisks); Ctrl+C cancels. A non-interactive stdin is refused, so a password can never be piped in from a file.

export function terminalPrompter(): Prompter {
  const stdin = process.stdin;
  if (!stdin.isTTY)
    throw new DemoSeedError('refusing: run this in an interactive terminal (stdin is not a TTY)');

  return {
    async line(question) {
      const rl = createInterface({ input: stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    hidden(question) {
      return new Promise((resolve, reject) => {
        process.stdout.write(question);
        let value = '';
        const finish = () => {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
        };
        const onData = (chunk: Buffer) => {
          for (const ch of chunk.toString('utf8')) {
            if (ch === '\r' || ch === '\n') {
              finish();
              resolve(value);
              return;
            }
            if (ch === '\u0003') {
              finish();
              reject(new DemoSeedError('cancelled; nothing was written'));
              return;
            }
            if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
            else if (ch >= ' ') value += ch;
          }
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
      });
    },
  };
}

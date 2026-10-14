import { configure } from '@testing-library/dom';

// Component tests wait for elements up to 5 s (the library default is 1 s): on the 8 GB development machine, with every
// test file running in parallel and other work alongside, renders are slower than that.
configure({ asyncUtilTimeout: 5_000 });

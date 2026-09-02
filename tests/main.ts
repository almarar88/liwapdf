import { runSuites } from './harness'
import formulas from './suites/formulas'
import arabic from './suites/arabic'
import pdfText from './suites/pdf-text'
import compress from './suites/compress'
import layout from './suites/layout'
import documents from './suites/documents'
import images from './suites/images'

void runSuites([formulas, arabic, pdfText, compress, layout, documents, images])

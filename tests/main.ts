import { runSuites } from './harness'
import formulas from './suites/formulas'
import arabic from './suites/arabic'
import pdfText from './suites/pdf-text'
import compress from './suites/compress'
import layout from './suites/layout'
import documents from './suites/documents'
import images from './suites/images'
import renderProbe from './suites/render-probe'
import docx from './suites/docx'
import pdfEdit from './suites/pdf-edit'

void runSuites([formulas, arabic, pdfText, compress, layout, documents, images, renderProbe, docx, pdfEdit])

import { dataReport } from '../server/catalog.js';
console.log(JSON.stringify({...dataReport,indb:{...dataReport.indb,primaryMatches:dataReport.indb.primaryMatches.length,skipped:dataReport.indb.skipped.length}},null,2));

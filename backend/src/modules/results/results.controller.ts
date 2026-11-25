import { Controller, Get, Query } from '@nestjs/common';
import { RequireModule, RequirePermission } from '../../core/auth/decorators';
import { ResultsQueryDto } from './dto/results.dto';
import { ResultsService } from './results.service';

/**
 * /api/results — term results of a section, computed from the marks.
 *   GET /results?termId=&sectionId=&provisional=          averages, ranks, statistics   (results.compute)
 *   GET /results/report-cards?termId=&sectionId=           one report card per student   (results.reportcard.generate)
 *
 * Only locked assessments count; provisional=true previews with submitted
 * and validated ones too.
 */
@RequireModule('results')
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  @RequirePermission('results.compute')
  section(@Query() query: ResultsQueryDto) {
    return this.results.section(query.termId, query.sectionId, query.provisional === 'true');
  }

  @Get('report-cards')
  @RequirePermission('results.reportcard.generate')
  reportCards(@Query() query: ResultsQueryDto) {
    return this.results.reportCards(query.termId, query.sectionId, query.provisional === 'true');
  }
}

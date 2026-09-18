import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ListingsService } from './listings/listings.service';
import { ObservationService } from './observation/observation.service';
import { DocsController, HealthController } from './http/health.controller';
import { ListingsController } from './http/listings.controller';
import { RegistryInfraModule } from './infra/registry-infra.module';

@Module({
  imports: [RegistryInfraModule, ScheduleModule.forRoot()],
  controllers: [HealthController, DocsController, ListingsController],
  providers: [ListingsService, ObservationService],
})
export class AppModule {}

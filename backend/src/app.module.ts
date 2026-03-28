import { Module } from '@nestjs/common';
import { SpeakersModule } from './speakers/speakers.module';

@Module({
  imports: [SpeakersModule],
})
export class AppModule {}

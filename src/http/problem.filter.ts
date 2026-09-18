import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { RegistryProblem } from '../domain/types';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof RegistryProblem) {
      if (exception.status === 429 && exception.detail) {
        res.setHeader('Retry-After', exception.detail);
      }
      res.status(exception.status).type('application/problem+json').json(exception.toBody());
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const title = typeof body === 'string' ? body : exception.message;
      res.status(status).type('application/problem+json').json({
        type: 'https://pools.federationcoin.org/problems/unknownField',
        title,
        status,
        code: status === 404 ? 'notFound' : 'unknownField',
      });
      return;
    }
    res.status(500).type('application/problem+json').json({
      type: 'https://pools.federationcoin.org/problems/unknownField',
      title: 'Internal error',
      status: 500,
      code: 'unknownField',
    });
  }
}

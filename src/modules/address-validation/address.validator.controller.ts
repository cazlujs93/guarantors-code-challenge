import { Controller, Post, Body, HttpStatus, HttpException } from '@nestjs/common';
import { ValidateAddressDto } from './dto/validate-address.dto';
import { Piscina } from 'piscina';
import * as path from "node:path";
import * as os from "node:os";

@Controller('address')
export class AddressValidatorController {
  private workerPool: Piscina<any, any>;
  constructor() {
    const totalCpus = os.cpus().length;
    // using worker_threads to process the validation, because is CPU bounding processing (regex) and some loop
    // that would block the event loop and would decrease responsiveness and would need more k8s pods to handle the traffic for example
    this.workerPool = new Piscina({
      filename: path.resolve(__dirname, 'address.validator.worker.js'),
      minThreads: Math.round(totalCpus / 2),
      maxThreads: totalCpus - 1,
      // to prevent DoS attacks, since regex is CPU-heavy
      idleTimeout: 5000,
      maxQueue: 10,
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 64,
        stackSizeMb: 4,
      }
    });
  }

  @Post('validate-address')
  async validateAddress(@Body() dto: ValidateAddressDto) {
    return this.workerPool.run(dto.address);
  }
}

import tgpu from "typegpu";
import * as d from "typegpu/data";
import { showWebGPUError } from "../../shared/webgpu-utils";

async function main() {
    const app = document.getElementById("app");
    if (!app) return;

    try {
        // TypeGPU練習用
        // ここでTypeGPUのAPIを試してみてください

        app.innerHTML = `
      <p>TypeGPU練習用のPlaygroundです。</p>
      <p>main.tsを編集してTypeGPUを試してみてください。</p>
    `;

        const WORKGROUP_SIZE = [64] as [number];
        const ARRAY_SIZE = 4;

        const MatrixStruct = d.struct({
            size: d.f32,
            numbers: d.arrayOf(d.f32, ARRAY_SIZE),
        });

        const layout = tgpu.bindGroupLayout({
            inputArray: { storage: MatrixStruct, access: "readonly" },
            resultArray: { storage: MatrixStruct, access: "mutable" },
        });

        const shaderCode = /* wgsl */ `

@group(0) @binding(0) var<storage, read> inputArray: MatrixStruct;
@group(0) @binding(1) var<storage, read_write> resultArray: MatrixStruct;

@compute @workgroup_size(${WORKGROUP_SIZE.join(", ")})
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  if (global_id.x >= u32(inputArray.size)) {
    return;
  }

  if (global_id.x == 0u) {
    resultArray.size = inputArray.size;
  }

  let index = global_id.x;
  resultArray.numbers[index] = inputArray.numbers[index] * 2.0;
}`;

        const root = await tgpu.init();
        const device = root.device;

        const inputArrayBuffer = root
            .createBuffer(MatrixStruct)
            .$usage("storage");
        const resultArrayBuffer = root
            .createBuffer(MatrixStruct)
            .$usage("storage");

        const pipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [root.unwrap(layout)],
            }),
            compute: {
                module: device.createShaderModule({
                    code: tgpu.resolve({
                        template: shaderCode,
                        externals: { MatrixStruct },
                    }),
                }),
            },
        });

        const bindGroup = root.createBindGroup(layout, {
            inputArray: inputArrayBuffer,
            resultArray: resultArrayBuffer,
        });

        async function run() {
            const inputArray = {
                size: ARRAY_SIZE,
                numbers: Array(ARRAY_SIZE)
                    .fill(0)
                    .map(() => Math.floor(Math.random() * 10)),
            };

            const resultArray = {
                size: ARRAY_SIZE,
                numbers: Array(ARRAY_SIZE).fill(0),
            };

            inputArrayBuffer.write(inputArray);
            resultArrayBuffer.write(resultArray);

            const workgroupCountX = Math.ceil(
                inputArray.size / WORKGROUP_SIZE[0]
            );

            const encoder = device.createCommandEncoder();

            const pass = encoder.beginComputePass();
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, root.unwrap(bindGroup));
            pass.dispatchWorkgroups(workgroupCountX);
            pass.end();

            device.queue.submit([encoder.finish()]);

            const result = await resultArrayBuffer.read();

            console.log("inputArray", inputArray);
            console.log("resultArray", result);
        }

        await run();

        root.destroy();
    } catch (error) {
        showWebGPUError(app, error as Error);
    }
}

main();

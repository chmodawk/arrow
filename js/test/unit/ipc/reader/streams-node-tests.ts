// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import {
    generateRandomTables,
    // generateDictionaryTables
} from '../../../data/tables';

import {
    Table,
    RecordBatchReader,
    RecordBatchStreamWriter
} from '../../../Arrow';

import { ArrowIOTestHelper } from '../helpers';
import { validateRecordBatchAsyncIterator } from '../validate';

(() => {

    if (process.env.TEST_NODE_STREAMS !== 'true') {
        return test('not testing node streams because process.env.TEST_NODE_STREAMS !== "true"', () => {});
    }

    /* tslint:disable */
    const { Readable, PassThrough } = require('stream');
    /* tslint:disable */
    const { parse: bignumJSONParse } = require('json-bignum');
    /* tslint:disable */
    const concatStream = ((multistream) => (...xs: any[]) =>
        new Readable().wrap(multistream(...xs))
    )(require('multistream'));

    for (const table of generateRandomTables([10, 20, 30])) {

        const file = ArrowIOTestHelper.file(table);
        const json = ArrowIOTestHelper.json(table);
        const stream = ArrowIOTestHelper.stream(table);
        const name = `[\n ${table.schema.fields.join(',\n ')}\n]`;

        describe(`RecordBatchReader.throughNode (${name})`, () => {
            describe('file', () => {
                test('fs.ReadStream', file.fsReadableStream(validate));
                test('stream.Readable', file.nodeReadableStream(validate));
            });
            describe('stream', () => {
                test('fs.ReadStream', file.fsReadableStream(validate));
                test('stream.Readable', file.nodeReadableStream(validate));
            });
            async function validate(source: NodeJS.ReadableStream) {
                const stream = source.pipe(RecordBatchReader.throughNode());
                await validateRecordBatchAsyncIterator(3, stream[Symbol.asyncIterator]());
            }
        });

        describe(`toNodeStream (${name})`, () => {

            describe(`RecordBatchJSONReader`, () => {
                test('Uint8Array', json.buffer((source) => validate(bignumJSONParse(`${Buffer.from(source)}`))));
            });

            describe(`RecordBatchFileReader`, () => {
                test(`Uint8Array`, file.buffer(validate));
                test(`Iterable`, file.iterable(validate));
                test('AsyncIterable', file.asyncIterable(validate));
                test('fs.FileHandle', file.fsFileHandle(validate));
                test('fs.ReadStream', file.fsReadableStream(validate));
                test('stream.Readable', file.nodeReadableStream(validate));
                test('whatwg.ReadableStream', file.whatwgReadableStream(validate));
                test('whatwg.ReadableByteStream', file.whatwgReadableByteStream(validate));
                test('Promise<AsyncIterable>', file.asyncIterable((source) => validate(Promise.resolve(source))));
                test('Promise<fs.FileHandle>', file.fsFileHandle((source) => validate(Promise.resolve(source))));
                test('Promise<fs.ReadStream>', file.fsReadableStream((source) => validate(Promise.resolve(source))));
                test('Promise<stream.Readable>', file.nodeReadableStream((source) => validate(Promise.resolve(source))));
                test('Promise<ReadableStream>', file.whatwgReadableStream((source) => validate(Promise.resolve(source))));
                test('Promise<ReadableByteStream>', file.whatwgReadableByteStream((source) => validate(Promise.resolve(source))));
            });

            describe(`RecordBatchStreamReader`, () => {
                test(`Uint8Array`, stream.buffer(validate));
                test(`Iterable`, stream.iterable(validate));
                test('AsyncIterable', stream.asyncIterable(validate));
                test('fs.FileHandle', stream.fsFileHandle(validate));
                test('fs.ReadStream', stream.fsReadableStream(validate));
                test('stream.Readable', stream.nodeReadableStream(validate));
                test('whatwg.ReadableStream', stream.whatwgReadableStream(validate));
                test('whatwg.ReadableByteStream', stream.whatwgReadableByteStream(validate));
                test('Promise<AsyncIterable>', stream.asyncIterable((source) => validate(Promise.resolve(source))));
                test('Promise<fs.FileHandle>', stream.fsFileHandle((source) => validate(Promise.resolve(source))));
                test('Promise<fs.ReadStream>', stream.fsReadableStream((source) => validate(Promise.resolve(source))));
                test('Promise<stream.Readable>', stream.nodeReadableStream((source) => validate(Promise.resolve(source))));
                test('Promise<ReadableStream>', stream.whatwgReadableStream((source) => validate(Promise.resolve(source))));
                test('Promise<ReadableByteStream>', stream.whatwgReadableByteStream((source) => validate(Promise.resolve(source))));
            });

            async function validate(source: any) {
                const reader: RecordBatchReader = await RecordBatchReader.from(source);
                await validateRecordBatchAsyncIterator(3, reader.toNodeStream()[Symbol.asyncIterator]());
            }
        });
    }

    it('readAll() should pipe to separate NodeJS WritableStreams', async () => {

        expect.hasAssertions();

        const tables = [...generateRandomTables([10, 20, 30])];

        const stream = concatStream(tables.map((table) =>
            () => RecordBatchStreamWriter.writeAll(table).toNodeStream()
        )) as NodeJS.ReadableStream;

        let tableIndex = -1;
        let reader: RecordBatchReader | undefined;

        for await (reader of RecordBatchReader.readAll(stream)) {

            validateStreamState(reader, stream, false);

            const output = reader
                .pipe(RecordBatchStreamWriter.throughNode())
                .pipe(new PassThrough());

            validateStreamState(reader, output, false);

            const sourceTable = tables[++tableIndex];
            const streamTable = await Table.from(output);
            expect(streamTable).toEqualTable(sourceTable);
            expect(Boolean(output.readableFlowing)).toBe(false);
        }

        expect(reader).toBeDefined();
        validateStreamState(reader!, stream, true);
        expect(tableIndex).toBe(tables.length - 1);
    });

    it('should not close the underlying NodeJS ReadableStream when reading multiple tables to completion', async () => {

        expect.hasAssertions();

        const tables = [...generateRandomTables([10, 20, 30])];

        const stream = concatStream(tables.map((table) =>
            () => RecordBatchStreamWriter.writeAll(table).toNodeStream()
        )) as NodeJS.ReadableStream;

        let tableIndex = -1;
        let reader = await RecordBatchReader.from(stream);

        validateStreamState(reader, stream, false);

        for await (reader of RecordBatchReader.readAll(reader)) {

            validateStreamState(reader, stream, false);

            const sourceTable = tables[++tableIndex];
            const streamTable = await Table.from(reader);
            expect(streamTable).toEqualTable(sourceTable);
        }

        validateStreamState(reader, stream, true);
        expect(tableIndex).toBe(tables.length - 1);
    });

    it('should close the underlying NodeJS ReadableStream when reading multiple tables and we break early', async () => {

        expect.hasAssertions();

        const tables = [...generateRandomTables([10, 20, 30])];

        const stream = concatStream(tables.map((table) =>
            () => RecordBatchStreamWriter.writeAll(table).toNodeStream()
        )) as NodeJS.ReadableStream;

        let tableIndex = -1;
        let reader = await RecordBatchReader.from(stream);

        validateStreamState(reader, stream, false);

        for await (reader of RecordBatchReader.readAll(reader)) {

            validateStreamState(reader, stream, false);

            let batchIndex = -1;
            const sourceTable = tables[++tableIndex];
            const breakEarly = tableIndex === (tables.length / 2 | 0);

            for await (const streamBatch of reader) {
                expect(streamBatch).toEqualRecordBatch(sourceTable.chunks[++batchIndex]);
                if (breakEarly && batchIndex === 1) { break; }
            }
            if (breakEarly) {
                // the reader should stay open until we break from the outermost loop
                validateStreamState(reader, stream, false);
                break;
            }
        }

        // stream.readable should be false here
        validateStreamState(reader, stream, true);
        expect(tableIndex).toBe(tables.length / 2 | 0);
    });
})();

function validateStreamState(reader: RecordBatchReader, stream: NodeJS.ReadableStream, closed: boolean, readable = !closed) {
    expect(reader.closed).toBe(closed);
    expect(Boolean(stream.readable)).toBe(readable);
    expect(Boolean((stream as any).destroyed)).toBe(closed);
    expect(Boolean((stream as any).readableFlowing)).toBe(false);
}

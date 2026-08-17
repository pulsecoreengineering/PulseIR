/**
 * CMake project emitter for the ESP-IDF target.
 *
 * ESP-IDF does not use Makefiles or sketches — it uses CMake with a specific
 * directory layout and a top-level CMakeLists.txt that the `idf.py` toolchain
 * knows how to drive.  This emitter generates that file from a PulseProject.
 *
 * The generated layout:
 *
 *   <outdir>/
 *     CMakeLists.txt          ← this emitter's output
 *     main/
 *       CMakeLists.txt        ← registers main.cpp as the app component
 *       main.cpp              ← from the C++ codegen (renamed from <name>.cpp)
 *       PulseHSM_config.h     ← from the C++ codegen (when a state machine exists)
 *     components/
 *       PulseHSM/             ← vendored runtime (when a state machine exists)
 *         PulseHSM.h
 *         PulseHSM.cpp
 */

import type { PulseProject } from '../model/index.js';

export interface CmakeFiles {
  /** Top-level CMakeLists.txt content. */
  topLevel: string;
  /** main/CMakeLists.txt content. */
  mainComponent: string;
}

export class CmakeEmitter {
  /**
   * Generate the CMake project files for the given project.
   *
   * `idfVersion` is the minimum IDF version to declare in CMakeLists.txt.
   * Defaults to "5.0" which covers the current stable release line.
   */
  /**
   * @param extraSrcs  Additional source filenames (basenames only, e.g. `"actions.cpp"`)
   *                   to add alongside `main.cpp` in the `idf_component_register` SRCS list.
   */
  generate(project: PulseProject, idfVersion = '5.0', extraSrcs: string[] = []): CmakeFiles {
    const name      = project.name;
    const hasMachine = project.system.states.length > 0;

    const topLevel       = this.topLevelCmake(name, idfVersion);
    const mainComponent  = this.mainComponentCmake(name, hasMachine, extraSrcs);

    return { topLevel, mainComponent };
  }

  private topLevelCmake(projectName: string, idfVersion: string): string {
    const safeName = projectName.replace(/[^A-Za-z0-9_]/g, '_');
    return [
      `cmake_minimum_required(VERSION 3.16)`,
      ``,
      `# ESP-IDF project setup — must come before project().`,
      `include($ENV{IDF_PATH}/tools/cmake/project.cmake)`,
      ``,
      `project(${safeName})`,
      ``,
      `# Declare the IDF version this project was generated against.`,
      `idf_build_set_property(MINIMUM_IDF_VERSION ${idfVersion})`,
      ``,
    ].join('\n');
  }

  private mainComponentCmake(_projectName: string, hasMachine: boolean, extraSrcs: string[] = []): string {
    const allSrcs = ['"main.cpp"', ...extraSrcs.map(s => `"${s}"`)];
    const srcsLine = allSrcs.length === 1
      ? `    SRCS ${allSrcs[0]}`
      : `    SRCS ${allSrcs.join('\n           ')}`;

    const requires = hasMachine
      ? `    REQUIRES driver esp_timer PulseHSM`
      : `    REQUIRES driver esp_timer`;

    return [
      `idf_component_register(`,
      srcsLine,
      `    INCLUDE_DIRS "."`,
      requires,
      `)`,
      ``,
    ].join('\n');
  }
}

// Global variables
let pyodide = null;
let filesData = [];

// Initialize Pyodide when page loads
window.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('parserForm');
    form.addEventListener('submit', handleFormSubmit);
    
    // Pre-load Pyodide in the background
    loadPyodideAndPackages();
});

// Load Pyodide
async function loadPyodideAndPackages() {
    if (!pyodide) {
        try {
            // Show a message that Pyodide is loading
            const processBtn = document.getElementById('processBtn');
            const originalBtnText = processBtn.innerHTML;
            processBtn.disabled = true;
            processBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Loading...';
            
            pyodide = await loadPyodide();
            console.log('Pyodide loaded successfully');
            
            // Restore button
            processBtn.disabled = false;
            processBtn.innerHTML = originalBtnText;

        } catch (error) {
            console.error('Failed to load Pyodide:', error);
            showError('Failed to load the processing engine. Please reload the page.');
        }
    }
    return pyodide;
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const fileInput = document.getElementById('fileInput');
    const startTimestep = parseInt(document.getElementById('startTimestep').value);
    const endTimestep = parseInt(document.getElementById('endTimestep').value);
    const intervalTimestep = parseInt(document.getElementById('intervalTimestep').value);
    const zipOption = document.getElementById('zipOption').checked;
    
    // Validate inputs
    if (!fileInput.files[0]) {
        showError('LAMMPSトラジェクトリファイルをアップロードしてください。');
        return;
    }
    
    if (isNaN(startTimestep) || isNaN(endTimestep) || startTimestep > endTimestep) {
        showError('有効な開始および終了タイムステップを入力してください。');
        return;
    }
    
    if (isNaN(intervalTimestep) || intervalTimestep < 1) {
        showError('有効な間隔を入力してください（1以上である必要があります）。');
        return;
    }
    
    // Process file
    await processFile(fileInput.files[0], startTimestep, endTimestep, intervalTimestep, zipOption);
}

// Process the LAMMPS file
async function processFile(file, startTimestep, endTimestep, intervalTimestep, zipOption) {
    // Show progress
    showProgress();
    
    // Reset files data
    filesData = [];
    
    try {
        // Read file content
        const fileContent = await file.text();
        const fileName = file.name;
        
        // Ensure Pyodide is loaded
        const py = await loadPyodideAndPackages();
        if (!py) return; // Stop if pyodide failed to load
        
        // Set Python globals
        py.globals.set('file_content', fileContent);
        py.globals.set('file_name', fileName);
        py.globals.set('start_timestep', startTimestep);
        py.globals.set('end_timestep', endTimestep);
        py.globals.set('interval_timestep', intervalTimestep);
        
        // Define window function for Python to call
        window.store_file_data = function(filename, content) {
            filesData.push({ filename, content });
        };
        
        // Run Python code
        const result = await py.runPythonAsync(getPythonCode());
        
        // Show results
        showOutput(result);
        
        // Handle downloads if files were generated
        if (filesData.length > 0) {
            await handleDownloads(zipOption, startTimestep, endTimestep, intervalTimestep);
        }
        
    } catch (error) {
        showError(`ファイルの処理中にエラーが発生しました: ${error.message}`);
    }
}

// Handle file downloads
async function handleDownloads(zipOption, startTimestep, endTimestep, intervalTimestep) {
    const outputDiv = document.getElementById('output');
    
    outputDiv.textContent += '\n\nダウンロードを準備しています...';
    
    if (zipOption) {
        // Create and download ZIP file
        try {
            const zip = new JSZip();
            
            // Add all files to ZIP
            filesData.forEach(file => {
                zip.file(file.filename, file.content);
            });
            
            // Generate ZIP file
            const content = await zip.generateAsync({ type: 'blob' });
            
            // Download ZIP
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lammps_xyz_files_${startTimestep}_to_${endTimestep}_interval_${intervalTimestep}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            const successMsg = '\n\n✅ ZIPファイルが正常にダウンロードされました！';
            outputDiv.textContent += successMsg;
            
        } catch (error) {
            showError(`ZIPファイルの作成中にエラーが発生しました: ${error.message}`);
        }
    } else {
        // Download individual files
        filesData.forEach((file, index) => {
            setTimeout(() => {
                const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, index * 100); // Stagger downloads
        });
        
        const successMsg = '\n\n✅ 個別ファイルが正常にダウンロードされました！';
        outputDiv.textContent += successMsg;
    }
}

// UI Helper Functions
function showProgress() {
    document.getElementById('progressSection').classList.remove('d-none', 'fade-in');
    document.getElementById('outputSection').classList.add('d-none');
    document.getElementById('processBtn').disabled = true;
    document.getElementById('progressSection').classList.add('fade-in');
}

function showOutput(content) {
    document.getElementById('progressSection').classList.add('d-none');
    document.getElementById('outputSection').classList.remove('d-none', 'fade-in');
    document.getElementById('output').textContent = content;
    document.getElementById('processBtn').disabled = false;
    document.getElementById('outputSection').classList.add('fade-in');
}

function showError(message) {
    document.getElementById('progressSection').classList.add('d-none');
    document.getElementById('outputSection').classList.remove('d-none');
    document.getElementById('output').textContent = `❌ エラー: ${message}`;
    document.getElementById('processBtn').disabled = false;
}


// Python code as a function
function getPythonCode() {
    return `
import js
from js import store_file_data
import sys
from io import StringIO

def parse_lammps(file_content, file_name, start_timestep, end_timestep, interval_timestep):
    output_log = []
    try:
        lines = file_content.split('\\n')
        
        i = 0
        while i < len(lines):
            # Find the start of a timestep block
            if lines[i].strip() == "ITEM: TIMESTEP":
                i += 1
                if i >= len(lines): break
                try:
                    current_timestep = int(lines[i].strip())
                except ValueError:
                    output_log.append(f"警告: ライン {i+1} で無効なタイムステップ値をスキップしました。")
                    i += 1
                    continue

                # Check if the timestep is within the desired range
                if current_timestep >= start_timestep and current_timestep <= end_timestep:
                    # Check if the timestep matches the interval
                    # We check (current_timestep - start_timestep) to ensure the interval logic starts from the 'start_timestep'
                    if (current_timestep - start_timestep) % interval_timestep == 0:
                        # Found a valid timestep, now parse the full block
                        i, block_data = parse_timestep_block(lines, i, current_timestep)
                        if block_data:
                            # If parsing was successful, generate XYZ file
                            xyz_content = format_to_xyz(block_data, file_name)
                            xyz_filename = f"output_timestep_{block_data['timestep']}.xyz"
                            # Use the JS function to store data
                            store_file_data(xyz_filename, xyz_content)
                            output_log.append(f"✓ 処理完了: {xyz_filename}")
                        else:
                            output_log.append(f"警告: タイムステップ {current_timestep} のブロックの解析に失敗しました。")
                            i += 1 # Move to the next line to avoid infinite loop
                    else:
                        i += 1 # Timestep not in interval, move to next line
                else:
                    i += 1 # Timestep not in range, move to next line
            else:
                i += 1 # Not a timestep line, move to next

        if not output_log:
             output_log.append("⚠️ 指定された範囲と間隔に一致するタイムステップが見つかりませんでした。")
        
        summary = create_summary(start_timestep, end_timestep, interval_timestep, output_log)
        return "\\n".join(output_log) + "\\n" + summary

    except Exception as e:
        # Capture more detailed error information
        import traceback
        exc_type, exc_value, exc_traceback = sys.exc_info()
        tb_str = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
        return f"❌ 予期せぬエラーが発生しました: {e}\\n{tb_str}"

def parse_timestep_block(lines, start_index, timestep):
    """Parses a single timestep block from the given start_index."""
    data = {'timestep': timestep, 'atoms': []}
    i = start_index
    try:
        while i < len(lines):
            line = lines[i].strip()
            if line == "ITEM: NUMBER OF ATOMS":
                i += 1
                data['N'] = int(lines[i].strip())
            elif line.startswith("ITEM: BOX BOUNDS"):
                i += 1
                data['xbounds'] = list(map(float, lines[i].strip().split()))
                i += 1
                data['ybounds'] = list(map(float, lines[i].strip().split()))
                i += 1
                data['zbounds'] = list(map(float, lines[i].strip().split()))
            # MODIFICATION: Handle the new "element" column format
            elif line.startswith("ITEM: ATOMS"):
                headers = line.split()[2:] # e.g., ['id', 'element', 'xs', 'ys', 'zs']
                
                # Find column indices
                try:
                    element_col = headers.index('element')
                    xs_col = headers.index('xs')
                    ys_col = headers.index('ys')
                    zs_col = headers.index('zs')
                except ValueError:
                    # Fallback for old format 'type'
                    try:
                        element_col = headers.index('type')
                        xs_col = headers.index('xs')
                        ys_col = headers.index('ys')
                        zs_col = headers.index('zs')
                    except ValueError:
                        return i, None # Cannot find required columns

                # Read atom data
                for j in range(data['N']):
                    i += 1
                    parts = lines[i].strip().split()
                    
                    element = parts[element_col]
                    xs = float(parts[xs_col])
                    ys = float(parts[ys_col])
                    zs = float(parts[zs_col])

                    # Calculate real coordinates
                    x = data['xbounds'][0] + xs * (data['xbounds'][1] - data['xbounds'][0])
                    y = data['ybounds'][0] + ys * (data['ybounds'][1] - data['ybounds'][0])
                    z = data['zbounds'][0] + zs * (data['zbounds'][1] - data['zbounds'][0])
                    
                    data['atoms'].append({'element': element, 'x': x, 'y': y, 'z': z})
                
                # After reading atoms, the block is complete
                return i + 1, data
            
            i += 1
        return i, None # Block was incomplete
    except (IndexError, ValueError) as e:
        # Error during parsing this block, return failure
        return i, None

def format_to_xyz(data, filename):
    """Formats the parsed data into an XYZ file string."""
    N = data['N']
    timestep = data['timestep']
    xb = data['xbounds']
    yb = data['ybounds']
    zb = data['zbounds']
    
    header = f"{N}\\n"
    comment = (f"Timestep {timestep} from {filename} "
               f"box {xb[0]:.6f} {xb[1]:.6f} {yb[0]:.6f} {yb[1]:.6f} {zb[0]:.6f} {zb[1]:.6f}\\n")
    
    atom_lines = []
    for atom in data['atoms']:
        line = f"{atom['element']} {atom['x']:.6f} {atom['y']:.6f} {atom['z']:.6f}\\n"
        atom_lines.append(line)
        
    return header + comment + "".join(atom_lines)

def create_summary(start, end, interval, log):
    file_count = sum(1 for line in log if line.startswith("✓"))
    summary_lines = [
        "\\n📊 サマリー:",
        f"タイムステップ範囲: {start} から {end}",
        f"間隔: {interval} タイムステップごと",
        f"生成されたファイル数: {file_count}"
    ]
    return "\\n".join(summary_lines)

# Execute the parser
result = parse_lammps(file_content, file_name, start_timestep, end_timestep, interval_timestep)
result
`;
}

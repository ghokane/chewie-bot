import React, { useEffect, useState } from "react";
import { makeStyles } from "@material-ui/core/styles";
import axios from "axios";
import MaterialTable from "material-table"
import { Box, Button, Grid, Card, TextField, CircularProgress, FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox, Typography } from "@material-ui/core";
import { Image } from "react-bootstrap";
import { DropzoneArea, DropzoneDialog } from "material-ui-dropzone";
import { AddToListState } from "../common/addToListState";
import AddIcon from "@material-ui/icons/Add";

const useStyles = makeStyles((theme) => ({
    addButton: {
        margin: theme.spacing(0, 0, 2),
    },
}));

type RowData = { id?: number, type: number, amount: number, seasonal: boolean, imageId: string, announcementMessage: string, url: string, name: string };
const MaxFileSize = 1024 * 1024 * 5;
const FileTypes = ["image/jpeg", "image/png"];

const ImageCell: React.FC<{value: RowData}> = ({value}) => {
    const [currentFile, setCurrentFile] = useState({ url: value.url});
    const [open, setOpen] = React.useState(false);

    const handleSave = async (files: File[]) => {
        for (const file of files) {
            const formData = new FormData();
            formData.append("achievement", JSON.stringify(value));
            formData.append("image", file);
            axios.post("/api/achievements/upload", formData, {
                headers: {
                  "Content-Type": "multipart/form-data"
                }
            }).then((result) => {
                if (result) {
                    setCurrentFile({url: result.data.url });
                }
                setOpen(false);
            });
        }
    }

    return <Grid container>
            <Grid item>
                <Image height={40} src={currentFile.url} style={{ marginRight: "0.5em" }} />
            </Grid>
            <Grid item>
                <Button variant="contained" color="primary" onClick={() => setOpen(true)}>
                    Change
                </Button>
                <DropzoneDialog
                    acceptedFiles={FileTypes}
                    initialFiles={[currentFile.url]}
                    maxFileSize={MaxFileSize}
                    open={open}
                    onClose={() => setOpen(false)}
                    onSave={(files) => handleSave(files)}
                    showPreviews={true}
                    showFileNamesInPreview={false}
                    filesLimit={1}
                />
            </Grid>
        </Grid>;
}

const AchievementsList: React.FC<any> = (props: any) => {
    const [achievementlist, setAchievementlist] = useState([] as RowData[]);
    const [achievementListState, setAchievementListState] = useState<AddToListState>();

    const [achievementType, setAchievementType] = useState<number>(0);
    const [achievementMsg, setAchievementMsg] = useState<string>("");
    const [achievementName, setAchievementName] = useState<string>("");
    const [achievementAmount, setAchievementAmount] = useState<number>(1);
    const [achievementSeasonal, setAchievementSeasonal] = useState<boolean>(false);
    const [achievementAmountIsNumberOfStreams, setAchievementAmountIsNumberOfStreams] = useState<boolean>(false);
    const [achievementFile, setAchievementFile] = useState<File>();

    const classes = useStyles();

    const achievementTypes = {
        0: "Songs requested",
        1: "Points collected",
        2: "Songs added to Songlist",
        3: "Unique cards collected",
        4: "Sudoku committed",
        5: "Redeemed animation",
        6: "Daily Taxes paid",
        7: "Duels won",
        8: "Total points won in Bankheist",
        9: "Total points lost in Bankheist",
        10: "Daily Taxes paid (Bits)",
        11: "Arenas won",
        12: "Unique cards upgraded",
    };

    useEffect(() => {
        axios.get("/api/achievements").then((response) => {
            setAchievementlist(response.data);
        });
    }, []);

    const submitForm = async () => {
        if (!achievementFile) {
            return;
        }

        try {
            setAchievementListState({state: "progress"});

            const newData = {
                type: achievementType,
                amount: achievementAmountIsNumberOfStreams ? -1 : achievementAmount,
                seasonal: achievementSeasonal,
                name: achievementName,
                announcementMessage: achievementMsg
            } as RowData;

            const formData = new FormData();
            formData.append("achievement", JSON.stringify(newData));
            formData.append("image", achievementFile);
            axios.post("/api/achievements/upload", formData, {
                headers: {
                  "Content-Type": "multipart/form-data"
                }
            }).then((result) => {
                const newList = [...achievementlist, result.data];
                setAchievementListState({state: "success"});
                setAchievementlist(newList);
                setAchievementType(0);
                setAchievementAmount(1);
                setAchievementMsg("");
                setAchievementName("");
                setAchievementSeasonal(false);
                setAchievementFile(undefined);
            }).catch(error => {
                setAchievementListState({
                    state: "failed",
                    message: error.response.data.error.message
            })});
        } catch (error) {
            setAchievementListState({
                state: "failed",
                message: error.message
            });
        }
    };

    const addForm = <Box mb={2}>
            <Card><Box py={1} px={2}>
                <form onSubmit={submitForm}>
                    <Grid container style={{ maxWidth: "90em" }}>
                        <Grid item xs={6}>
                            <Grid item>
                                <FormControl fullWidth style={{ marginTop: 15 }}>
                                    <InputLabel>Type</InputLabel>
                                    <Select
                                        value={achievementType}
                                        onChange={(event: React.ChangeEvent<{ name?: string | undefined; value: unknown; }>) => setAchievementType(event.target.value as number ?? 0)}>
                                        {Object.entries(achievementTypes).map(([key, value]) => <MenuItem value={key}>{value}</MenuItem>)}
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item>
                                <TextField
                                    id="achievement-msg"
                                    label="Announcement message"
                                    fullWidth
                                    value={achievementMsg}
                                    onChange={(e) => setAchievementMsg(e.target.value)}
                                />
                            </Grid>
                            <Grid item>
                                <TextField
                                    id="achievement-name"
                                    label="Title"
                                    fullWidth
                                    value={achievementName}
                                    onChange={(e) => setAchievementName(e.target.value)}
                                />
                            </Grid>
                            <Grid item container alignItems="center" direction="row">
                                <Grid item>
                                    <TextField
                                        id="achievement-amount"
                                        label="Amount required"
                                        type="number"
                                        InputProps={{ inputProps: { min: 1 } }}
                                        fullWidth
                                        disabled={achievementAmountIsNumberOfStreams}
                                        value={achievementAmount}
                                        onChange={(e) => setAchievementAmount(parseInt(e.target.value, 10))}
                                    />
                                </Grid>
                                <Grid item>
                                    <FormControlLabel style={{marginTop: "1.5em", marginLeft: "0.5em"}}
                                        control={
                                        <Checkbox
                                            checked={achievementAmountIsNumberOfStreams}
                                            onChange={(e) => setAchievementAmountIsNumberOfStreams(e.target.checked)}
                                            name="achievement-isnumberofstreams"
                                        />}
                                        label="Use number of streams in season"
                                    />
                                </Grid>
                            </Grid>
                            <Grid item>
                                <FormControlLabel
                                    control={
                                    <Checkbox
                                        checked={achievementSeasonal || achievementAmountIsNumberOfStreams}
                                        readOnly={achievementAmountIsNumberOfStreams}
                                        onChange={(e) => setAchievementSeasonal(e.target.checked)}
                                        name="achievement-seasonal"
                                        color="primary"
                                    />}
                                    label="Seasonal (archive when season ends)"
                                />
                            </Grid>
                            <Grid item>
                                <Button
                                    variant="contained"
                                    color="primary"
                                    startIcon={achievementListState?.state === "progress" ? <CircularProgress size={15} /> : <AddIcon />}
                                    onClick={submitForm}
                                    className={classes.addButton}
                                    disabled={achievementListState?.state === "progress" || !achievementFile || !achievementAmount}>
                                    Add
                                </Button>
                            </Grid>
                        </Grid>
                        <Grid item xs={6}>
                            <Box ml={2}>
                                <DropzoneArea maxFileSize={MaxFileSize} acceptedFiles={FileTypes} filesLimit={1}
                                    onChange={(files) => setAchievementFile(files.length === 0 ? undefined : files[0])} initialFiles={achievementFile ? [achievementFile] : undefined} />
                            </Box>
                        </Grid>
                    </Grid>
                </form>
            </Box></Card>
        </Box>;

    return <div>
            {addForm}
            <MaterialTable
                columns = {[
                    {
                        title: "Event type", field: "type",
                        defaultSort: "asc",
                        lookup: achievementTypes
                    },
                    { title: "Title", field: "name", },
                    {
                        title: "Amount", field: "amount", type: "numeric",
                        render: rowData => <Typography>{rowData.amount === -1 ? "Every stream in season" : rowData.amount}</Typography>,
                        editComponent: editProps => (
                            <Grid container justify="flex-end">
                                <Grid item>
                                    <TextField style={{width: "8em"}}
                                        type="number"
                                        InputProps={{ inputProps: { min: 1 } }}
                                        disabled={editProps.rowData.amount === -1}
                                        fullWidth
                                        value={editProps.rowData.amount}
                                        onChange={(e) => editProps.onChange(e.target.value)}
                                    />
                                </Grid>
                                <Grid item>
                                    <FormControlLabel
                                        control={
                                        <Checkbox style={{marginLeft: "0.5em"}}
                                            checked={editProps.rowData.amount === -1}
                                            onChange={(e) => editProps.onChange(e.target.checked ? -1 : 1)}
                                        />}
                                        label="Every stream in season"
                                    />
                                </Grid>
                            </Grid>
                          )
                    },
                    { title: "Seasonal", field: "seasonal", type: "boolean" },
                    { title: "Announcement message", field: "announcementMessage", },
                    { title: "Image", field: "image", render: rowData => <ImageCell value={rowData} />, editable: "never" }
                ]}
                options = {{
                    paging: false,
                    actionsColumnIndex: 6,
                    showTitle: false,
                    addRowPosition: "first",
                    tableLayout: "auto",
                }}
                data = {achievementlist}
                editable = {
                    {
                        isEditable: rowData => true,
                        isDeletable: rowData => true,
                        onRowUpdate: (newData, oldData) => axios.post("/api/achievements", newData).then((result) => {
                            if (result.status === 200) {
                                const newList = [...achievementlist];
                                // @ts-ignore
                                const index = oldData?.tableData.id;
                                newList[index] = newData;
                                setAchievementlist(newList);
                            }
                        }),
                        onRowDelete: oldData => axios.post("/api/achievements/delete", oldData).then((result) => {
                            if (result.status === 200) {
                                const newList = [...achievementlist];
                                // @ts-ignore
                                const index = oldData?.tableData.id;
                                newList.splice(index, 1);
                                setAchievementlist(newList);
                            }
                        })
                    }
                }
            />
    </div>;
};

export default AchievementsList;
